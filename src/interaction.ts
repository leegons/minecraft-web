import * as THREE from 'three';
import { Player } from './player';
import { World } from './world';
import type { WorldRaycastHit } from './world';
import { BlockType } from './constants';
import type { GameMode } from './constants';
import { audioSystem } from './audio';
import { ParticleSystem } from './particles';
import { Inventory } from './inventory';

export class Interaction {
    private world: World;
    private player: Player;
    private particles: ParticleSystem;

    private currentBlockType: BlockType = BlockType.DIRT;
    private reach = 5; // 最大交互距离
    private inventory: Inventory;
    private gameMode: GameMode;

    private outlineMesh: THREE.LineSegments;
    private readonly onMouseDown: (event: MouseEvent) => void;
    private readonly onContextMenu: (event: MouseEvent) => void;
    private readonly rayDirection = new THREE.Vector3();

    constructor(world: World, player: Player, particles: ParticleSystem, inventory: Inventory, gameMode: GameMode) {
        this.world = world;
        this.player = player;
        this.particles = particles;
        this.inventory = inventory;
        this.gameMode = gameMode;
        this.onMouseDown = (event: MouseEvent) => {
            audioSystem.init();
            if (!this.player.controls.isLocked) return;

            if (event.button === 0) {
                this.interact(false);
            } else if (event.button === 2) {
                this.interact(true);
            }
        };
        this.onContextMenu = (event: MouseEvent) => {
            if (this.player.controls.isLocked) {
                event.preventDefault();
            }
        };

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
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('contextmenu', this.onContextMenu);
    }

    /**
     * 处理挖掘或放置逻辑
     * @param isPlacing true 为放置方块，false 为破坏方块
     */
    public interact(isPlacing: boolean) {
        const hit = this.getTargetBlock();
        if (!hit) return;

        if (isPlacing) {
            const wx = hit.block.x + hit.normal.x;
            const wy = hit.block.y + hit.normal.y;
            const wz = hit.block.z + hit.normal.z;

            if (this.wouldBlockIntersectPlayer(wx, wy, wz)) {
                return;
            }

            if (this.gameMode === 'survival') {
                if (!this.inventory.removeNotify(this.currentBlockType)) return;
            }

            this.world.setBlock(wx, wy, wz, this.currentBlockType);
            audioSystem.playPop();
            return;
        }

        const wx = hit.block.x;
        const wy = hit.block.y;
        const wz = hit.block.z;
        const oldType = hit.type;
        if (oldType !== BlockType.AIR && oldType !== BlockType.WATER) {
            let color = 0xffffff;
            if (oldType === BlockType.GRASS) color = 0x55aa55;
            else if (oldType === BlockType.DIRT) color = 0x8b5a2b;
            else if (oldType === BlockType.STONE) color = 0x888888;
            else if (oldType === BlockType.WOOD) color = 0x7a5230;
            else if (oldType === BlockType.LEAVES) color = 0x3c8c30;

            this.particles.breakBlock(wx, wy, wz, color);
            audioSystem.playCrunch();

            if (oldType === BlockType.BEDROCK) return;
            if (this.gameMode === 'survival') {
                this.inventory.addNotify(oldType);
            }
        }

        this.world.setBlock(wx, wy, wz, BlockType.AIR);
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

    private getTargetBlock(): WorldRaycastHit | null {
        this.player.camera.getWorldDirection(this.rayDirection);
        return this.world.raycast(this.player.camera.position, this.rayDirection, this.reach);
    }

    /**
     * 每帧更新：计算光标位置选中的方块并显示轮廓
     * 桌面端仅在指针已锁定时执行射线检测，避免无效计算
     */
    public update() {
        if (!this.player.isMobile && !this.player.controls.isLocked) {
            this.outlineMesh.visible = false;
            return;
        }

        const hit = this.getTargetBlock();
        if (hit && hit.type !== BlockType.AIR) {
            this.outlineMesh.position.copy(hit.block);
            this.outlineMesh.visible = true;
            return;
        }

        this.outlineMesh.visible = false;
    }

    public dispose() {
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('contextmenu', this.onContextMenu);
        this.world.scene.remove(this.outlineMesh);
        this.outlineMesh.geometry.dispose();
        if (this.outlineMesh.material instanceof THREE.Material) {
            this.outlineMesh.material.dispose();
        }
    }
}
