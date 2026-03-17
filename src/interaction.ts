import * as THREE from 'three';
import { Player } from './player';
import { World } from './world';
import { BlockType } from './constants';
import type { GameMode } from './constants';
import { audioSystem } from './audio';
import { ParticleSystem } from './particles';
import { Inventory } from './inventory';

export class Interaction {
    private raycaster = new THREE.Raycaster();
    private center = new THREE.Vector2(0, 0); // 屏幕中心点
    private world: World;
    private player: Player;
    private particles: ParticleSystem;

    private currentBlockType: BlockType = BlockType.DIRT;
    private reach = 5; // 最大交互距离
    private inventory: Inventory;
    private gameMode: GameMode;

    private outlineMesh: THREE.LineSegments;

    constructor(world: World, player: Player, particles: ParticleSystem, inventory: Inventory, gameMode: GameMode) {
        this.world = world;
        this.player = player;
        this.particles = particles;
        this.inventory = inventory;
        this.gameMode = gameMode;

        // 设置选中方块的线条轮廓
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001));
        const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
        this.outlineMesh = new THREE.LineSegments(edges, lineMat);
        this.outlineMesh.visible = false;
        this.world.scene.add(this.outlineMesh);

        this.setupEventListeners();
    }

    /**
     * 设置鼠标交互监听
     */
    private setupEventListeners() {
        document.addEventListener('mousedown', (event) => {
            // 在第一次交互时初始化音频上下文
            audioSystem.init();

            // 仅在指针缩进（游戏激活）状态下允许交互
            if (!this.player.controls.isLocked) return;

            if (event.button === 0) {
                // 左键：挖掘/破坏方块
                this.interact(false);
            } else if (event.button === 2) {
                // 右键：放置方块
                this.interact(true);
            }
        });

        // 禁用指针锁定时右键的浏览器上下文菜单
        document.addEventListener('contextmenu', (event) => {
            if (this.player.controls.isLocked) {
                event.preventDefault();
            }
        });
    }

    /**
     * 处理挖掘或放置逻辑
     * @param isPlacing true 为放置方块，false 为破坏方块
     */
    public interact(isPlacing: boolean) {
        this.raycaster.setFromCamera(this.center, this.player.camera);
        // 限制射线的射程
        this.raycaster.far = this.reach;

        const meshes = this.world.getMeshes();
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            const hit = intersects[0];
            if (!hit.face) return;

            let targetPoint = hit.point.clone();

            if (isPlacing) {
                // 沿着法线方向向外移动半个单位，确保落点在新方块所在的空间
                targetPoint.add(hit.face.normal.clone().multiplyScalar(0.5));

                const wx = Math.round(targetPoint.x);
                const wy = Math.round(targetPoint.y);
                const wz = Math.round(targetPoint.z);

                // 检查放置的方块是否会把玩家困在里面
                if (this.wouldBlockIntersectPlayer(wx, wy, wz)) {
                    return;
                }

                // 生存模式：检查背包是否有对应方块
                if (this.gameMode === 'survival') {
                    if (!this.inventory.removeNotify(this.currentBlockType)) return;
                }

                this.world.setBlock(wx, wy, wz, this.currentBlockType);
                audioSystem.playPop();

            } else {
                // 沿着法线方向向内移动半个单位，确保落点在被击中的方块内部
                targetPoint.sub(hit.face.normal.clone().multiplyScalar(0.5));

                const wx = Math.round(targetPoint.x);
                const wy = Math.round(targetPoint.y);
                const wz = Math.round(targetPoint.z);

                const oldType = this.world.getBlock(wx, wy, wz);
                if (oldType !== BlockType.AIR && oldType !== BlockType.WATER) {
                    // 根据方块类型设置粒子颜色
                    let color = 0xffffff;
                    if (oldType === BlockType.GRASS) color = 0x55aa55;
                    else if (oldType === BlockType.DIRT) color = 0x8b5a2b;
                    else if (oldType === BlockType.STONE) color = 0x888888;
                    else if (oldType === BlockType.WOOD) color = 0x7a5230;
                    else if (oldType === BlockType.LEAVES) color = 0x3c8c30;

                    this.particles.breakBlock(wx, wy, wz, color);
                    audioSystem.playCrunch();

                    // 生存模式：基岩不可破坏，其他方块掉落进背包
                    if (oldType === BlockType.BEDROCK) return;
                    if (this.gameMode === 'survival') {
                        this.inventory.addNotify(oldType);
                    }
                }

                this.world.setBlock(wx, wy, wz, BlockType.AIR);
            }
        }
    }

    // 镜像 player.ts 中的碰撞检测尺寸
    private readonly PLAYER_RADIUS = 0.3;
    private readonly PLAYER_EYE_HEIGHT = 1.4;
    private readonly PLAYER_HEAD_CLEARANCE = 0.2;

    /**
     * 辅助函数：判断方块坐标是否与玩家当前位置重叠（防止卡人）
     */
    private wouldBlockIntersectPlayer(wx: number, wy: number, wz: number): boolean {
        const cam = this.player.camera.position;
        const r = this.PLAYER_RADIUS;

        // 玩家包围盒
        const pMinX = cam.x - r, pMaxX = cam.x + r;
        const pMinY = cam.y - this.PLAYER_EYE_HEIGHT, pMaxY = cam.y + this.PLAYER_HEAD_CLEARANCE;
        const pMinZ = cam.z - r, pMaxZ = cam.z + r;

        // 方块占据的范围是 [n-0.5, n+0.5]
        if (wx + 0.5 <= pMinX || wx - 0.5 >= pMaxX) return false;
        if (wy + 0.5 <= pMinY || wy - 0.5 >= pMaxY) return false;
        if (wz + 0.5 <= pMinZ || wz - 0.5 >= pMaxZ) return false;
        return true;
    }

    public setBlockType(type: BlockType) {
        this.currentBlockType = type;
    }

    public getInventory(): Inventory { return this.inventory; }

    /**
     * 每帧更新：计算光标位置选中的方块并显示轮廓
     */
    public update() {
        this.raycaster.setFromCamera(this.center, this.player.camera);
        this.raycaster.far = this.reach;

        const meshes = this.world.getMeshes();
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            const hit = intersects[0];
            if (hit.face) {
                // 沿着法线内部定位方块中心
                const targetPoint = hit.point.clone().sub(hit.face.normal.clone().multiplyScalar(0.5));

                const wx = Math.round(targetPoint.x);
                const wy = Math.round(targetPoint.y);
                const wz = Math.round(targetPoint.z);

                const oldType = this.world.getBlock(wx, wy, wz);
                if (oldType !== BlockType.AIR) {
                    this.outlineMesh.position.set(wx, wy, wz);
                    this.outlineMesh.visible = true;
                    return;
                }
            }
        }

        this.outlineMesh.visible = false;
    }
}
