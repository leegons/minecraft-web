import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

import { blockMaterials } from './textures';
import { Save } from './save';

import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_SIZE, BlockType } from './constants';
import type { GameMode } from './constants';
export { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_SIZE, BlockType };

export interface WorldRaycastHit {
    block: THREE.Vector3;
    normal: THREE.Vector3;
    type: BlockType;
}

export class World {
    public scene: THREE.Scene;
    private noise2D: (x: number, y: number) => number;

    // 按坐标字符串 "x,z" 存储区块数据
    private chunks: Map<string, Uint8Array> = new Map();
    // 存储区块对应的网格(Mesh)
    private chunkMeshes: Map<string, THREE.Mesh> = new Map();
    // 存储植被（草、花）的实例化网格，用于性能优化
    private floraMeshes: Map<string, Map<BlockType, THREE.InstancedMesh>> = new Map();
    // 存储合并后的水面网格
    private waterMeshes: Map<string, THREE.Mesh> = new Map();

    // 缓存材质信息，用于构建区块几何体
    private flatMaterials: THREE.Material[] = [];
    private blockTypeToMatIndex: Record<number, number | number[]> = {};

    // 动态区块加载参数
    private readonly RENDER_DISTANCE = 4; // 每个方向加载的区块数量（渲染距离）
    private readonly CHUNKS_PER_FRAME = 2; // 每帧最多生成/构建网格的区块数量，防止卡顿
    private playerChunkX = 0;
    private playerChunkZ = 0;
    private generateQueue: Array<[number, number]> = [];
    private meshQueue: Array<[number, number]> = [];
    private generateQueueKeys: Set<string> = new Set();
    private meshQueueKeys: Set<string> = new Set();
    private collidableMeshes: THREE.Object3D[] = [];
    private collidableMeshesDirty = true;

    // 海平面常量
    private readonly SEA_LEVEL = 14;
    public readonly mode: GameMode;

    constructor(scene: THREE.Scene, mode: GameMode = 'creative') {
        this.scene = scene;
        this.mode = mode;
        this.noise2D = createNoise2D(); // 初始化 Simplex 噪声用于地形生成
        this.initMaterials();

        // 初始加载原点附近的区块
        this.updatePlayerChunk(0, 0);
    }

    /**
     * 每帧调用，根据玩家位置更新区块加载
     */
    public update(playerPos: THREE.Vector3) {
        const cx = Math.floor(playerPos.x / CHUNK_SIZE);
        const cz = Math.floor(playerPos.z / CHUNK_SIZE);

        if (cx !== this.playerChunkX || cz !== this.playerChunkZ) {
            this.updatePlayerChunk(cx, cz);
        }

        this.processQueues(); // 处理区块生成和网格构建队列
    }

    /**
     * 当进入新区块时更新队列
     */
    private updatePlayerChunk(cx: number, cz: number) {
        this.playerChunkX = cx;
        this.playerChunkZ = cz;
        const rd = this.RENDER_DISTANCE;

        // 卸载视距（+1 缓冲区）之外的区块
        const unloadDist = rd + 1;
        for (const key of this.chunkMeshes.keys()) {
            const [kx, kz] = key.split(',').map(Number);
            if (Math.abs(kx - cx) > unloadDist || Math.abs(kz - cz) > unloadDist) {
                this.unloadChunk(kx, kz);
            }
        }

        // 按照距离从小到大（最近优先）将新区块加入生成队列
        const toLoad: Array<[number, number, number]> = [];
        for (let dx = -rd; dx <= rd; dx++) {
            for (let dz = -rd; dz <= rd; dz++) {
                const ncx = cx + dx, ncz = cz + dz;
                const key = this.getChunkKey(ncx, ncz);
                if (!this.chunks.has(key)) {
                    const dist = Math.abs(dx) + Math.abs(dz);
                    toLoad.push([ncx, ncz, dist]);
                }
            }
        }
        toLoad.sort((a, b) => a[2] - b[2]);

        // 重置生成队列
        this.generateQueue = [];
        this.generateQueueKeys.clear();
        for (const [x, z] of toLoad) {
            this.enqueueGenerate(x, z);
        }
        this.meshQueue = [];
        this.meshQueueKeys.clear();
    }

    /**
     * 分步处理耗时的区块任务，避免掉帧
     */
    private processQueues() {
        let generatedCount = 0;
        while (this.generateQueue.length > 0 && generatedCount < this.CHUNKS_PER_FRAME) {
            const [qx, qz] = this.generateQueue.shift()!;
            this.generateQueueKeys.delete(this.getChunkKey(qx, qz));
            if (!this.chunks.has(this.getChunkKey(qx, qz))) {
                this.generateChunk(qx, qz);
                // 区块生成后，需要重新构建自身及邻居的网格（解决接缝处的遮挡关系）
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const nKey = this.getChunkKey(qx + dx, qz + dz);
                        if (this.chunks.has(nKey)) {
                            this.enqueueMesh(qx + dx, qz + dz);
                        }
                    }
                }
            }
            generatedCount++;
        }

        let meshedCount = 0;
        while (this.meshQueue.length > 0 && meshedCount < this.CHUNKS_PER_FRAME) {
            const [qx, qz] = this.meshQueue.shift()!;
            this.meshQueueKeys.delete(this.getChunkKey(qx, qz));
            if (this.chunks.has(this.getChunkKey(qx, qz))) {
                this.buildChunkMesh(qx, qz);
            }
            meshedCount++;
        }
    }

    private enqueueGenerate(cx: number, cz: number) {
        const key = this.getChunkKey(cx, cz);
        if (this.generateQueueKeys.has(key) || this.chunks.has(key)) return;
        this.generateQueue.push([cx, cz]);
        this.generateQueueKeys.add(key);
    }

    private enqueueMesh(cx: number, cz: number) {
        const key = this.getChunkKey(cx, cz);
        if (this.meshQueueKeys.has(key) || !this.chunks.has(key)) return;
        this.meshQueue.push([cx, cz]);
        this.meshQueueKeys.add(key);
    }

    private markCollidableMeshesDirty() {
        this.collidableMeshesDirty = true;
    }

    private unloadChunk(cx: number, cz: number) {
        const key = this.getChunkKey(cx, cz);

        const mesh = this.chunkMeshes.get(key);
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            this.chunkMeshes.delete(key);
            this.markCollidableMeshesDirty();
        }

        const floraMap = this.floraMeshes.get(key);
        if (floraMap) {
            for (const m of floraMap.values()) {
                this.scene.remove(m);
                m.dispose();
            }
            this.floraMeshes.delete(key);
            this.markCollidableMeshesDirty();
        }

        const waterMesh = this.waterMeshes.get(key);
        if (waterMesh) {
            this.scene.remove(waterMesh);
            waterMesh.geometry.dispose();
            if (waterMesh.material instanceof THREE.Material) waterMesh.material.dispose();
            this.waterMeshes.delete(key);
            this.markCollidableMeshesDirty();
        }

        if (!Save.isChunkModified(this.mode, cx, cz)) {
            this.chunks.delete(key);
        }
    }

    private initMaterials() {
        for (const [t, mat] of Object.entries(blockMaterials)) {
            const type = parseInt(t) as BlockType;
            if (Array.isArray(mat)) {
                const indices = [];
                for (let i = 0; i < 6; i++) {
                    let mIdx = this.flatMaterials.indexOf(mat[i]);
                    if (mIdx === -1) {
                        mIdx = this.flatMaterials.length;
                        // Clone the material to enable vertexColors specifically for block meshing
                        const cloned = mat[i].clone();
                        cloned.vertexColors = true;
                        this.flatMaterials.push(cloned);
                    }
                    indices.push(mIdx);
                }
                this.blockTypeToMatIndex[type] = indices;
            } else {
                let mIdx = this.flatMaterials.indexOf(mat);
                if (mIdx === -1) {
                    mIdx = this.flatMaterials.length;
                    const cloned = mat.clone();
                    cloned.vertexColors = true;
                    this.flatMaterials.push(cloned);
                }
                this.blockTypeToMatIndex[type] = mIdx;
            }
        }
    }

    private getChunkKey(cx: number, cz: number): string {
        return `${cx},${cz}`;
    }

    private generateChunk(cx: number, cz: number) {
        // 首先尝试从本地存储加载
        const saved = Save.loadChunk(this.mode, cx, cz);
        if (saved) {
            const key = this.getChunkKey(cx, cz);
            this.chunks.set(key, saved);
            return;
        }

        const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);

        if (this.mode === 'flat') {
            this.generateFlatChunk(data);
        } else {
            this.generateNormalChunk(cx, cz, data);
        }

        const key = this.getChunkKey(cx, cz);
        this.chunks.set(key, data);
    }

    /**
     * 生成超平坦地形
     */
    private generateFlatChunk(data: Uint8Array) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                // y=0: 基岩, y=1-3: 泥土, y=4: 草方块, 以上为空气
                data[this.getBlockIndex(x, 0, z)] = BlockType.BEDROCK;
                for (let y = 1; y <= 3; y++) data[this.getBlockIndex(x, y, z)] = BlockType.DIRT;
                data[this.getBlockIndex(x, 4, z)] = BlockType.GRASS;
            }
        }
    }

    /**
     * 生成普通随机地形 (包含噪声、湖泊、生物群系逻辑等)
     */
    private generateNormalChunk(cx: number, cz: number, data: Uint8Array) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                // 世界全局坐标
                const wx = cx * CHUNK_SIZE + x;
                const wz = cz * CHUNK_SIZE + z;

                // 使用噪声生成高度
                let heightValue = this.noise2D(wx * 0.05, wz * 0.05) * 0.5 + 0.5; // 映射到 0 到 1
                let surfaceHeight = Math.floor(heightValue * 15) + 10; // 生成 10 到 25 之间的地表高度

                for (let y = 0; y < CHUNK_HEIGHT; y++) {
                    const index = this.getBlockIndex(x, y, z);

                    if (y > surfaceHeight) {
                        // 如果在海平面以下则填充水，否则空气
                        if (y <= this.SEA_LEVEL) {
                            data[index] = BlockType.WATER;
                        } else {
                            data[index] = BlockType.AIR;
                        }
                    } else if (y === surfaceHeight) {
                        if (y < this.SEA_LEVEL) {
                            // 水下地面使用泥土
                            data[index] = BlockType.DIRT;
                        } else {
                            // 海平面及以上使用草地
                            data[index] = BlockType.GRASS;
                            // 在干燥地面生成植被
                            if (surfaceHeight > this.SEA_LEVEL && surfaceHeight + 1 < CHUNK_HEIGHT) {
                                const floraNoise = this.noise2D(wx * 0.8 + 1000, wz * 0.8 + 1000);
                                const topIndex = this.getBlockIndex(x, y + 1, z);
                                if (floraNoise > 0.6) {
                                    data[topIndex] = BlockType.TALL_GRASS;
                                } else if (floraNoise < -0.8) {
                                    data[topIndex] = BlockType.FLOWER;
                                }
                            }
                        }
                    } else if (y > surfaceHeight - 3) {
                        data[index] = BlockType.DIRT;
                    } else {
                        data[index] = BlockType.STONE;
                    }
                }
            }
        }

        // --- 树木生成 ---
        // 基于坐标的伪随机算法
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const wx = cx * CHUNK_SIZE + x;
                const wz = cz * CHUNK_SIZE + z;

                const treeNoise = this.noise2D(wx * 0.3 + 500, wz * 0.3 + 500);
                if (treeNoise > 0.72) {
                    let heightValue = this.noise2D(wx * 0.05, wz * 0.05) * 0.5 + 0.5;
                    let surfaceHeight = Math.floor(heightValue * 15) + 10;

                    // 仅在海平面以上、且有足够高度空间的地方生成树木
                    if (surfaceHeight > this.SEA_LEVEL && surfaceHeight + 7 < CHUNK_HEIGHT) {
                        const trunkBase = surfaceHeight + 1;
                        const trunkTop = trunkBase + 4;

                        // 树干 (4格高)
                        for (let y = trunkBase; y <= trunkTop; y++) {
                            if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
                                data[this.getBlockIndex(x, y, z)] = BlockType.WOOD;
                            }
                        }

                        // 树冠: 顶层 3x3, 中层 5x5
                        const canopyLevels = [
                            { yOff: 5, radius: 2 },
                            { yOff: 4, radius: 2 },
                            { yOff: 3, radius: 1 },
                        ];

                        for (const { yOff, radius } of canopyLevels) {
                            const ly = trunkBase + yOff;
                            for (let dx = -radius; dx <= radius; dx++) {
                                for (let dz = -radius; dz <= radius; dz++) {
                                    const lx = x + dx;
                                    const lz = z + dz;
                                    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && ly < CHUNK_HEIGHT) {
                                        const idx = this.getBlockIndex(lx, ly, lz);
                                        if (data[idx] === BlockType.AIR) {
                                            data[idx] = BlockType.LEAVES;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * 将 3D 局部坐标转换为一维数组索引
     */
    private getBlockIndex(x: number, y: number, z: number): number {
        return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
    }

    /**
     * 判断方块是否是“固体”（用于视线遮挡和面剔除）
     */
    private isSolid(type: BlockType): boolean {
        return type !== BlockType.AIR && type !== BlockType.WATER && type !== BlockType.TALL_GRASS && type !== BlockType.FLOWER && type !== BlockType.LEAVES;
    }

    /**
     * 辅助函数：判断方块是否遮挡光线（用于简单的 AO 环境光遮蔽计算）
     */
    private isOccluding(wx: number, wy: number, wz: number): boolean {
        const type = this.getBlock(wx, wy, wz);
        return type !== BlockType.AIR && type !== BlockType.WATER && type !== BlockType.TALL_GRASS && type !== BlockType.FLOWER;
    }

    /**
     * 构建区块网格。该方法极具性能挑战，采用了：
     * 1. 面剔除 (Face Culling): 只渲染暴露在空气/水中的面
     * 2. 几何体合并 (Geometry Merging): 将同类方块合并为一个 BufferGeometry
     * 3. 实例化渲染 (InstancedMesh): 用于渲染大量重复的植被（草、花）
     * 4. 顶点着色 环境光遮蔽 (Vertex AO): 模拟方块角落的阴影效果
     */
    private buildChunkMesh(cx: number, cz: number) {
        const key = this.getChunkKey(cx, cz);
        const data = this.chunks.get(key);
        if (!data) return;

        // 清理旧网格，释放显存
        const oldMesh = this.chunkMeshes.get(key);
        if (oldMesh) {
            this.scene.remove(oldMesh);
            if (oldMesh.geometry) oldMesh.geometry.dispose();
        }

        const oldFloraMap = this.floraMeshes.get(key);
        if (oldFloraMap) {
            for (const m of oldFloraMap.values()) {
                this.scene.remove(m);
                m.dispose();
            }
        }

        const oldWaterMesh = this.waterMeshes.get(key);
        if (oldWaterMesh) {
            this.scene.remove(oldWaterMesh);
            if (oldWaterMesh.geometry) oldWaterMesh.geometry.dispose();
            if (oldWaterMesh.material instanceof THREE.Material) oldWaterMesh.material.dispose();
        }

        // 实体方块的数据缓冲区
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const colors: number[] = [];
        let indexOffset = 0;

        // 渲染分组：根据材质索引存储索引数组
        const groups: Map<number, number[]> = new Map();

        const addFaceToGroup = (matIndex: number, idx0: number, idx1: number, idx2: number, idx3: number, idx4: number, idx5: number) => {
            if (!groups.has(matIndex)) groups.set(matIndex, []);
            groups.get(matIndex)!.push(idx0, idx1, idx2, idx3, idx4, idx5);
        };

        const floraCounts = new Map<BlockType, number>();

        // AO 亮度曲线：遮挡越严重颜色越暗
        const aoCurve = [0.4, 0.6, 0.8, 1.0];

        /**
         * 定义立方体的 6 个面信息
         * 顺序：右(+X), 左(-X), 上(+Y), 下(-Y), 前(+Z), 后(-Z)
         */
        const voxelFaces = [
            { dir: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
            { dir: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
            { dir: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
            { dir: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
            { dir: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
            { dir: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }
        ];

        let waterMesh: THREE.Mesh | null = null;
        const waterPositions: number[] = [];
        const waterIndices: number[] = [];
        const waterColorArr: number[] = [];

        // 遍历区块内的每个坐标点
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    const blockType = data[this.getBlockIndex(x, y, z)] as BlockType;

                    if (blockType !== BlockType.AIR) {
                        const wx = cx * CHUNK_SIZE + x;
                        const wy = y;
                        const wz = cz * CHUNK_SIZE + z;

                        if (blockType === BlockType.WATER) {
                            // 水体渲染逻辑：只渲染暴露在外的面
                            const wc = new THREE.Color(0x3366ff);
                            const hw = BLOCK_SIZE / 2;

                            for (let f = 0; f < 6; f++) {
                                const face = voxelFaces[f];
                                const nx = wx + face.dir[0];
                                const ny = wy + face.dir[1];
                                const nz = wz + face.dir[2];

                                const neighbor = (ny < 0 || ny >= CHUNK_HEIGHT) ? BlockType.AIR : this.getBlock(nx, ny, nz);
                                if (neighbor === BlockType.AIR || neighbor === BlockType.TALL_GRASS || neighbor === BlockType.FLOWER) {
                                    const vOffset = waterPositions.length / 3;
                                    for (let v = 0; v < 4; v++) {
                                        const corner = face.corners[v];
                                        const yOffset = (face.dir[1] === 1) ? -0.05 : 0; // 顶面略微下移避免 Z-fighting
                                        waterPositions.push(
                                            wx * BLOCK_SIZE + corner[0] * hw,
                                            wy * BLOCK_SIZE + corner[1] * hw + yOffset,
                                            wz * BLOCK_SIZE + corner[2] * hw
                                        );
                                        waterColorArr.push(wc.r, wc.g, wc.b);
                                    }
                                    waterIndices.push(vOffset, vOffset + 1, vOffset + 2, vOffset, vOffset + 2, vOffset + 3);
                                }
                            }
                        } else if (blockType === BlockType.TALL_GRASS || blockType === BlockType.FLOWER) {
                            // 草和花计数，后续统一进行实例化渲染
                            floraCounts.set(blockType, (floraCounts.get(blockType) || 0) + 1);
                        } else {
                            // 实体方块处理
                            for (let f = 0; f < 6; f++) {
                                const face = voxelFaces[f];
                                const nx = wx + face.dir[0];
                                const ny = wy + face.dir[1];
                                const nz = wz + face.dir[2];

                                // 面剔除核心逻辑：如果邻接方块是隐藏的面（如泥土包围石头），则不产生几何体
                                let exposed = true;
                                if (ny >= 0 && ny < CHUNK_HEIGHT) {
                                    const neighbor = this.getBlock(nx, ny, nz);
                                    if (this.isSolid(neighbor) && neighbor !== BlockType.LEAVES) {
                                        exposed = false;
                                    }
                                }

                                if (exposed) {
                                    const hw = BLOCK_SIZE / 2;
                                    // 为面的 4 个顶点计算光照和 AO
                                    for (let v = 0; v < 4; v++) {
                                        const corner = face.corners[v];
                                        const px = wx * BLOCK_SIZE + corner[0] * hw;
                                        const py = wy * BLOCK_SIZE + corner[1] * hw;
                                        const pz = wz * BLOCK_SIZE + corner[2] * hw;

                                        positions.push(px, py, pz);
                                        normals.push(face.dir[0], face.dir[1], face.dir[2]);
                                        uvs.push(face.uv[v][0], face.uv[v][1]);

                                        // --- 基础方块 AO 计算逻辑 ---
                                        // 检查面拐角处的 3 个邻接方块是否遮挡光线
                                        const oDir1 = [corner[0], 0, 0];
                                        const oDir2 = [0, 0, corner[2]];
                                        if (Math.abs(face.dir[0]) > 0) { // X 面
                                            oDir1[0] = 0; oDir1[1] = corner[1]; oDir2[0] = 0;
                                        } else if (Math.abs(face.dir[1]) > 0) { // Y 面
                                            oDir1[1] = 0; oDir2[1] = 0;
                                        } else { // Z 面
                                            oDir1[2] = 0; oDir2[2] = 0; oDir1[0] = corner[0]; oDir2[1] = corner[1];
                                        }

                                        const s1 = this.isOccluding(nx + oDir1[0], ny + oDir1[1], nz + oDir1[2]) ? 1 : 0;
                                        const s2 = this.isOccluding(nx + oDir2[0], ny + oDir2[1], nz + oDir2[2]) ? 1 : 0;
                                        const cor = this.isOccluding(nx + oDir1[0] + oDir2[0], ny + oDir1[1] + oDir2[1], nz + oDir1[2] + oDir2[2]) ? 1 : 0;

                                        let aoValue = (s1 && s2) ? 3 : (s1 + s2 + cor);
                                        const lum = aoCurve[3 - aoValue]; // 获取对应的颜色亮度
                                        colors.push(lum, lum, lum);
                                    }

                                    // 确定该面所属的材质（Minecraft 风格，顶面、侧面、底面可能不同）
                                    const matMapping = this.blockTypeToMatIndex[blockType];
                                    const matIndex = Array.isArray(matMapping) ? matMapping[f] : matMapping;

                                    const a = indexOffset;
                                    const b = indexOffset + 1;
                                    const c = indexOffset + 2;
                                    const d = indexOffset + 3;
                                    // 两个三角形组成一个矩形面
                                    addFaceToGroup(matIndex, a, b, c, a, c, d);
                                    indexOffset += 4;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 构建实体方块最终网格
        if (positions.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

            const finalIndices: number[] = [];
            for (let i = 0; i < this.flatMaterials.length; i++) {
                const arr = groups.get(i);
                if (arr && arr.length > 0) {
                    geo.addGroup(finalIndices.length, arr.length, i);
                    finalIndices.push(...arr);
                }
            }
            geo.setIndex(finalIndices);

            const mesh = new THREE.Mesh(geo, this.flatMaterials);
            mesh.receiveShadow = false;
            this.scene.add(mesh);
            this.chunkMeshes.set(key, mesh);
        } else {
            this.chunkMeshes.delete(key);
        }

        // 构建植被实例化网格 (Flora Instanced Mesh)
        const newFloraMeshesMap = new Map<BlockType, THREE.InstancedMesh>();
        if (floraCounts.size > 0) {
            // 使用“十字交叉平面”几何体模拟草和花
            const crossGeo = new THREE.BufferGeometry();
            const hw = BLOCK_SIZE / 2;
            const floraPts = new Float32Array([
                -hw, -hw, -hw, hw, -hw, hw, -hw, hw, -hw, hw, -hw, hw, hw, hw, hw, -hw, hw, -hw,
                hw, -hw, -hw, -hw, -hw, hw, hw, hw, -hw, -hw, -hw, hw, -hw, hw, hw, hw, hw, -hw
            ]);
            const floraUvs = new Float32Array([
                0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1,
                1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1
            ]);
            crossGeo.setAttribute('position', new THREE.BufferAttribute(floraPts, 3));
            crossGeo.setAttribute('uv', new THREE.BufferAttribute(floraUvs, 2));
            crossGeo.computeVertexNormals();

            const floraIndices = new Map<BlockType, number>();
            const dummy = new THREE.Object3D();

            for (const [type, count] of floraCounts.entries()) {
                const mat = blockMaterials[type as keyof typeof blockMaterials];
                if (mat) {
                    const mesh = new THREE.InstancedMesh(crossGeo, mat, count);
                    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                    this.scene.add(mesh);
                    newFloraMeshesMap.set(type, mesh);
                    floraIndices.set(type, 0);
                }
            }

            // 更新每个实例的矩阵（位置）
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let y = 0; y < CHUNK_HEIGHT; y++) {
                    for (let z = 0; z < CHUNK_SIZE; z++) {
                        const blockType = data[this.getBlockIndex(x, y, z)] as BlockType;
                        if (blockType === BlockType.FLOWER || blockType === BlockType.TALL_GRASS) {
                            const wx = cx * CHUNK_SIZE + x;
                            const wy = y;
                            const wz = cz * CHUNK_SIZE + z;
                            dummy.position.set(wx * BLOCK_SIZE, wy * BLOCK_SIZE, wz * BLOCK_SIZE);
                            dummy.updateMatrix();

                            const mesh = newFloraMeshesMap.get(blockType);
                            const idx = floraIndices.get(blockType)!;
                            mesh?.setMatrixAt(idx, dummy.matrix);
                            floraIndices.set(blockType, idx + 1);
                        }
                    }
                }
            }

            for (const mesh of newFloraMeshesMap.values()) {
                mesh.instanceMatrix.needsUpdate = true;
                mesh.computeBoundingSphere();
            }
        }
        this.floraMeshes.set(key, newFloraMeshesMap);

        // 构建合并后的水体网格
        if (waterPositions.length > 0) {
            const waterGeometry = new THREE.BufferGeometry();
            waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
            waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColorArr, 3));
            waterGeometry.setIndex(waterIndices);
            waterGeometry.computeVertexNormals();

            const mergedWaterMat = new THREE.MeshLambertMaterial({
                color: 0xffffff,
                vertexColors: true,
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide
            });

            waterMesh = new THREE.Mesh(waterGeometry, mergedWaterMat);
            this.scene.add(waterMesh);
            this.waterMeshes.set(key, waterMesh);
        } else {
            this.waterMeshes.delete(key);
        }

        this.markCollidableMeshesDirty();
    }

    /**
     * 获取当前所有活动的网格对象
     */
    public getMeshes(): THREE.Object3D[] {
        if (this.collidableMeshesDirty) {
            this.collidableMeshes = [];
            for (const mesh of this.chunkMeshes.values()) this.collidableMeshes.push(mesh);
            for (const map of this.floraMeshes.values()) this.collidableMeshes.push(...Array.from(map.values()));
            for (const mesh of this.waterMeshes.values()) this.collidableMeshes.push(mesh);
            this.collidableMeshesDirty = false;
        }
        return this.collidableMeshes;
    }

    /**
     * 获取指定全局世界坐标处的方块类型
     */
    public getBlock(wx: number, wy: number, wz: number): BlockType {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cz = Math.floor(wz / CHUNK_SIZE);
        const x = Math.floor(wx) - cx * CHUNK_SIZE;
        const y = Math.floor(wy);
        const z = Math.floor(wz) - cz * CHUNK_SIZE;

        if (y < 0 || y >= CHUNK_HEIGHT) return BlockType.AIR;
        const key = this.getChunkKey(cx, cz);
        const chunk = this.chunks.get(key);
        if (!chunk) return BlockType.AIR;
        return chunk[this.getBlockIndex(x, y, z)] as BlockType;
    }

    public raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): WorldRaycastHit | null {
        if (direction.lengthSq() === 0) return null;

        // Shift by half a block so voxel cells map cleanly to integer-centered blocks.
        let x = origin.x + 0.5;
        let y = origin.y + 0.5;
        let z = origin.z + 0.5;

        let voxelX = Math.floor(x);
        let voxelY = Math.floor(y);
        let voxelZ = Math.floor(z);

        const stepX = Math.sign(direction.x);
        const stepY = Math.sign(direction.y);
        const stepZ = Math.sign(direction.z);

        const invDx = direction.x !== 0 ? Math.abs(1 / direction.x) : Number.POSITIVE_INFINITY;
        const invDy = direction.y !== 0 ? Math.abs(1 / direction.y) : Number.POSITIVE_INFINITY;
        const invDz = direction.z !== 0 ? Math.abs(1 / direction.z) : Number.POSITIVE_INFINITY;

        let tMaxX = stepX !== 0
            ? ((stepX > 0 ? voxelX + 1 : voxelX) - x) / direction.x
            : Number.POSITIVE_INFINITY;
        let tMaxY = stepY !== 0
            ? ((stepY > 0 ? voxelY + 1 : voxelY) - y) / direction.y
            : Number.POSITIVE_INFINITY;
        let tMaxZ = stepZ !== 0
            ? ((stepZ > 0 ? voxelZ + 1 : voxelZ) - z) / direction.z
            : Number.POSITIVE_INFINITY;

        let distance = 0;
        const normal = new THREE.Vector3();

        while (distance <= maxDistance) {
            const type = this.getBlock(voxelX, voxelY, voxelZ);
            if (type !== BlockType.AIR) {
                return {
                    block: new THREE.Vector3(voxelX, voxelY, voxelZ),
                    normal: normal.clone(),
                    type,
                };
            }

            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    voxelX += stepX;
                    distance = tMaxX;
                    tMaxX += invDx;
                    normal.set(-stepX, 0, 0);
                } else {
                    voxelZ += stepZ;
                    distance = tMaxZ;
                    tMaxZ += invDz;
                    normal.set(0, 0, -stepZ);
                }
            } else {
                if (tMaxY < tMaxZ) {
                    voxelY += stepY;
                    distance = tMaxY;
                    tMaxY += invDy;
                    normal.set(0, -stepY, 0);
                } else {
                    voxelZ += stepZ;
                    distance = tMaxZ;
                    tMaxZ += invDz;
                    normal.set(0, 0, -stepZ);
                }
            }
        }

        return null;
    }

    /**
     * 修改指定全局世界坐标处的方块，并触发周围区块重绘
     */
    public setBlock(wx: number, wy: number, wz: number, type: BlockType) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cz = Math.floor(wz / CHUNK_SIZE);
        const x = Math.floor(wx) - cx * CHUNK_SIZE;
        const y = Math.floor(wy);
        const z = Math.floor(wz) - cz * CHUNK_SIZE;

        if (y < 0 || y >= CHUNK_HEIGHT) return;
        const key = this.getChunkKey(cx, cz);
        const chunk = this.chunks.get(key);

        if (chunk) {
            chunk[this.getBlockIndex(x, y, z)] = type;
            Save.saveChunk(this.mode, cx, cz, chunk);
            this.enqueueMesh(cx, cz);

            // 如果修改的是区块边界方块，需要重绘相邻区块以防出现空隙（主要是 AO 阴影需要更新）
            if (x === 0) this.enqueueMesh(cx - 1, cz);
            if (x === CHUNK_SIZE - 1) this.enqueueMesh(cx + 1, cz);
            if (z === 0) this.enqueueMesh(cx, cz - 1);
            if (z === CHUNK_SIZE - 1) this.enqueueMesh(cx, cz + 1);
        }
    }

    public dispose() {
        this.generateQueue = [];
        this.meshQueue = [];
        this.generateQueueKeys.clear();
        this.meshQueueKeys.clear();

        for (const key of Array.from(this.chunkMeshes.keys())) {
            const [cx, cz] = key.split(',').map(Number);
            this.unloadChunk(cx, cz);
        }
        this.chunks.clear();
        this.collidableMeshes = [];
        this.markCollidableMeshesDirty();
    }
}
