import * as THREE from 'three';
import { World } from './world';
import { BlockType } from './constants';

// 简单的种子随机函数，用于生成一致的 NPC 外观
function seededRandom(seed: number) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// 随机肤色和衣物颜色池
const SKIN_COLORS = [0xffcc99, 0xf0b27a, 0xc68642, 0xd4a574, 0x8d5524, 0xffe0bd];
const SHIRT_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e];
const PANTS_COLORS = [0x2c3e50, 0x1a252f, 0x2e4057, 0x5d4e75, 0x3d5a80];

export class NPC {
    private group: THREE.Group;
    private world: World;

    // 物理属性
    public position: THREE.Vector3;
    private velocity: THREE.Vector3 = new THREE.Vector3();
    private onGround = false;

    // AI 状态
    private targetX: number;
    private targetZ: number;
    private wanderTimer = 0;
    private readonly WANDER_INTERVAL = 3 + Math.random() * 4; // 3-7 秒更换一次目标
    private readonly MOVE_SPEED = 1.8 + Math.random() * 0.8;
    private readonly GRAVITY = -18;
    private readonly JUMP_FORCE = 7;

    // 动画肢体
    private leftArm: THREE.Object3D;
    private rightArm: THREE.Object3D;
    private leftLeg: THREE.Object3D;
    private rightLeg: THREE.Object3D;
    private head: THREE.Object3D;
    private animTime = 0;

    // 名字标签
    private nameTag: THREE.Sprite;
    private names = ['橘子', '方方', '小明', '花花', '大壮', '宝贝', '小七', '阿强', '晴天', '小鱼'];
    private name: string;

    constructor(world: World, spawnX: number, spawnZ: number, seed: number) {
        this.world = world;
        this.name = this.names[Math.floor(seededRandom(seed) * this.names.length)];

        // 寻找地表生成高度
        let spawnY = 20;
        for (let y = 31; y >= 0; y--) {
            const b = world.getBlock(spawnX, y, spawnZ);
            if (b !== BlockType.AIR && b !== BlockType.WATER) {
                spawnY = y + 1;
                break;
            }
        }
        this.position = new THREE.Vector3(spawnX, spawnY, spawnZ);
        this.targetX = spawnX;
        this.targetZ = spawnZ;

        const skin = SKIN_COLORS[Math.floor(seededRandom(seed + 1) * SKIN_COLORS.length)];
        const shirt = SHIRT_COLORS[Math.floor(seededRandom(seed + 2) * SHIRT_COLORS.length)];
        const pants = PANTS_COLORS[Math.floor(seededRandom(seed + 3) * PANTS_COLORS.length)];

        this.group = new THREE.Group();

        // 快捷创建方块网格
        const box = (w: number, h: number, d: number, color: number) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            const mat = new THREE.MeshLambertMaterial({ color });
            return new THREE.Mesh(geo, mat);
        };

        // --- 像素风格头像生成逻辑 ---
        const HAIR_COLORS = [0x1a0a00, 0x3b1f00, 0x7b4f00, 0xd4a017, 0x8b0000, 0x888888];
        const hairColor = HAIR_COLORS[Math.floor(seededRandom(seed + 5) * HAIR_COLORS.length)];

        const hex2rgb = (hex: number) => {
            const r = (hex >> 16) & 0xff;
            const g = (hex >> 8) & 0xff;
            const b = hex & 0xff;
            return `rgb(${r},${g},${b})`;
        };

        // 在 8x8 画布上绘制像素并转为纹理
        const makeHeadTex = (paint: (put: (x: number, y: number, color: string) => void) => void) => {
            const c = document.createElement('canvas');
            c.width = 8; c.height = 8;
            const ctx = c.getContext('2d')!;
            paint((x, y, color) => {
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 1, 1);
            });
            const t = new THREE.CanvasTexture(c);
            t.magFilter = THREE.NearestFilter; // 使用邻近过滤保持像素锐利
            t.minFilter = THREE.NearestFilter;
            return t;
        };

        const skinC = hex2rgb(skin);
        const hairC = hex2rgb(hairColor);
        const skinD = hex2rgb(Math.max(0, skin - 0x181818)); // 阴影肤色

        // 正脸：绘制眼睛、鼻子和嘴巴
        const frontTex = makeHeadTex((put) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, skinC);
            for (let x = 0; x < 8; x++) put(x, 0, hairC);
            for (let x = 0; x < 8; x++) put(x, 1, hairC);
            // 左眼
            put(1, 2, '#ffffff'); put(2, 2, '#ffffff');
            put(1, 3, '#ffffff'); put(2, 3, '#ffffff');
            put(1, 3, '#333333'); put(2, 2, '#333333');
            // 右眼
            put(5, 2, '#ffffff'); put(6, 2, '#ffffff');
            put(5, 3, '#ffffff'); put(6, 3, '#ffffff');
            put(5, 3, '#333333'); put(6, 2, '#333333');
            // 鼻子
            put(3, 4, skinD); put(4, 4, skinD);
            // 嘴巴
            put(2, 6, '#7a3030'); put(3, 6, '#7a3030');
            put(4, 6, '#7a3030'); put(5, 6, '#7a3030');
        });

        const topTex = makeHeadTex((put) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, hairC);
        });

        const botTex = makeHeadTex((put) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, skinC);
        });

        const sideTex = makeHeadTex((put) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, skinC);
            for (let x = 0; x < 8; x++) { put(x, 0, hairC); put(x, 1, hairC); }
        });

        const backTex = makeHeadTex((put) => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, skinD);
            for (let x = 0; x < 8; x++) { put(x, 0, hairC); put(x, 1, hairC); }
        });

        const headMats = [
            new THREE.MeshLambertMaterial({ map: sideTex }),   // +X
            new THREE.MeshLambertMaterial({ map: sideTex }),   // -X
            new THREE.MeshLambertMaterial({ map: topTex }),    // +Y
            new THREE.MeshLambertMaterial({ map: botTex }),    // -Y
            new THREE.MeshLambertMaterial({ map: frontTex }),  // +Z
            new THREE.MeshLambertMaterial({ map: backTex }),   // -Z
        ];

        const head = new THREE.Object3D();
        const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMats);
        head.add(headMesh);
        head.position.set(0, 1.6, 0);
        this.head = head;
        this.group.add(head);

        // 身体
        const bodyMesh = box(0.5, 0.7, 0.25, shirt);
        const bodyObj = new THREE.Object3D();
        bodyObj.add(bodyMesh);
        bodyObj.position.set(0, 1.05, 0);
        this.group.add(bodyObj);

        // 左臂
        const leftArm = new THREE.Object3D();
        const leftArmMesh = box(0.2, 0.65, 0.2, skin);
        leftArmMesh.position.set(0, -0.325, 0); // 旋转中心设在顶部
        leftArm.add(leftArmMesh);
        leftArm.position.set(-0.35, 1.4, 0);
        this.leftArm = leftArm;
        this.group.add(leftArm);

        // 右臂
        const rightArm = new THREE.Object3D();
        const rightArmMesh = box(0.2, 0.65, 0.2, skin);
        rightArmMesh.position.set(0, -0.325, 0);
        rightArm.add(rightArmMesh);
        rightArm.position.set(0.35, 1.4, 0);
        this.rightArm = rightArm;
        this.group.add(rightArm);

        // 左腿
        const leftLeg = new THREE.Object3D();
        const leftLegMesh = box(0.22, 0.65, 0.22, pants);
        leftLegMesh.position.set(0, -0.325, 0);
        leftLeg.add(leftLegMesh);
        leftLeg.position.set(-0.13, 0.7, 0);
        this.leftLeg = leftLeg;
        this.group.add(leftLeg);

        // 右腿
        const rightLeg = new THREE.Object3D();
        const rightLegMesh = box(0.22, 0.65, 0.22, pants);
        rightLegMesh.position.set(0, -0.325, 0);
        rightLeg.add(rightLegMesh);
        rightLeg.position.set(0.13, 0.7, 0);
        this.rightLeg = rightLeg;
        this.group.add(rightLeg);

        // 名字标签精灵 (Sprite)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 8);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Microsoft YaHei, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.name, canvas.width / 2, canvas.height / 2);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        this.nameTag = new THREE.Sprite(spriteMat);
        this.nameTag.scale.set(1.2, 0.3, 1);
        this.nameTag.position.set(0, 2.1, 0);
        this.group.add(this.nameTag);

        this.group.position.copy(this.position);
        world.scene.add(this.group);
    }

    /**
     * 随机选择一个新的游走目标点
     */
    private pickNewTarget() {
        const range = 8;
        this.targetX = this.position.x + (Math.random() * range * 2 - range);
        this.targetZ = this.position.z + (Math.random() * range * 2 - range);
    }

    /**
     * 每帧更新 AI 逻辑和动画
     */
    update(delta: number, cameraPosition: THREE.Vector3) {
        this.wanderTimer += delta;
        if (this.wanderTimer >= this.WANDER_INTERVAL) {
            this.wanderTimer = 0;
            this.pickNewTarget();
        }

        // 移动向目标
        const dx = this.targetX - this.position.x;
        const dz = this.targetZ - this.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        let moving = false;
        if (dist > 0.5) {
            moving = true;
            const speed = this.MOVE_SPEED;
            this.velocity.x = (dx / dist) * speed;
            this.velocity.z = (dz / dist) * speed;

            // 转向移动方向
            this.group.rotation.y = Math.atan2(dx, dz);

            // 遇到障碍物自动跳跃
            if (this.onGround) {
                const aheadX = Math.round(this.position.x + (dx / dist) * 0.8);
                const aheadZ = Math.round(this.position.z + (dz / dist) * 0.8);
                const blockAhead = this.world.getBlock(aheadX, Math.floor(this.position.y), aheadZ);
                if (blockAhead !== BlockType.AIR && blockAhead !== BlockType.WATER) {
                    this.velocity.y = this.JUMP_FORCE;
                    this.onGround = false;
                }
            }
        } else {
            this.velocity.x *= 0.2;
            this.velocity.z *= 0.2;
        }

        // 重力模拟
        if (!this.onGround) {
            this.velocity.y += this.GRAVITY * delta;
        }

        // 应用位移
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;
        this.position.y += this.velocity.y * delta;

        // 地面碰撞检测（简易版）
        const groundY = Math.floor(this.position.y);
        const blockBelow = this.world.getBlock(Math.round(this.position.x), groundY, Math.round(this.position.z));
        if (blockBelow !== BlockType.AIR && blockBelow !== BlockType.WATER && this.velocity.y <= 0) {
            this.position.y = groundY + 1;
            this.velocity.y = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }

        // 确保不会掉出世界底部
        if (this.position.y < 0) {
            this.position.y = 0;
            this.velocity.y = 0;
        }

        // 走路时的肢体摆动动画
        if (moving) {
            this.animTime += delta * 6;
        } else {
            this.animTime *= 0.85; // 停止时平滑回正
        }
        const swing = Math.sin(this.animTime) * 0.5;
        this.leftArm.rotation.x = swing;
        this.rightArm.rotation.x = -swing;
        this.leftLeg.rotation.x = -swing;
        this.rightLeg.rotation.x = swing;

        // 头部轻微闲置左右晃动
        this.head.rotation.y = Math.sin(this.animTime * 0.3) * 0.3;

        this.group.position.copy(this.position);

        // 名字标签始终面向摄像机（看板/Billboard 效果）
        if (cameraPosition) {
          this.nameTag.lookAt(cameraPosition);
        }
    }

    dispose() {
        this.world.scene.remove(this.group);
    }
}
