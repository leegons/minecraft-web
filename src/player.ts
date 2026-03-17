import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { World } from './world';
import { BlockType } from './constants';
import type { GameMode } from './constants';

export class Player {
    public camera: THREE.PerspectiveCamera;
    public controls: PointerLockControls;
    public world: World;

    // 移动状态标志位
    private moveForward = false;
    private moveBackward = false;
    private moveLeft = false;
    private moveRight = false;
    private canJump = false;
    private inWater = false;

    // 移动端专用控制属性
    public joystickVector = new THREE.Vector2(); // x, y 范围为 -1 到 1
    private euler = new THREE.Euler(0, 0, 0, 'YXZ');
    private PI_2 = Math.PI / 2;

    // 运动向量
    private velocity = new THREE.Vector3();
    private direction = new THREE.Vector3();

    // 物理常数
    private speed = 50.0;
    private gravity = 30.0;
    private jumpForce = 15.0;
    private waterGravity = 5.0;  // 水下重力（较弱）
    private waterDrag = 8.0;     // 水中阻力
    private swimForce = 8.0;     // 向上游泳的推力

    // 玩家碰撞箱尺寸（摄像头位于头部位置）
    private playerRadius = 0.3;
    private playerEyeHeight = 1.4; // 眼睛到脚底的距离
    private playerHeadClearance = 0.2; // 眼睛到头顶的距离

    // 飞行状态（创造模式）
    public isFlying = false;
    public flyUp = false;
    public flyDown = false;
    public gameMode: GameMode = 'creative';

    // 移动端标志
    public isMobile = false;

    constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, world: World, mode: GameMode = 'creative') {
        this.camera = camera;
        this.world = world;
        this.gameMode = mode;
        this.controls = new PointerLockControls(camera, domElement);

        // 设置生成高度，平坦模式较低，普通模式较高
        const spawnY = mode === 'flat' ? 8 : 30;
        this.camera.position.set(0, spawnY, 0);

        this.setupEventListeners();
    }

    /**
     * 设置键盘监听事件
     */
    private setupEventListeners() {
        const onKeyDown = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = true;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = true;
                    break;
                case 'Space': {
                    if (this.gameMode === 'creative') {
                        if (this.isFlying) {
                            this.flyUp = true;
                        } else if (this.canJump) {
                            this.velocity.y = this.jumpForce;
                            this.canJump = false;
                        }
                    } else {
                        if (this.canJump) {
                            this.velocity.y = this.jumpForce;
                            this.canJump = false;
                        } else if (this.inWater) {
                            this.velocity.y = this.swimForce;
                        }
                    }
                    break;
                }
                case 'KeyX':
                    if (this.gameMode === 'creative') {
                        this.toggleFlight();
                    }
                    break;
                case 'ShiftLeft':
                case 'ControlLeft':
                    if (this.isFlying) this.flyDown = true;
                    break;
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = false;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = false;
                    break;
                case 'Space':
                    this.flyUp = false;
                    break;
                case 'ShiftLeft':
                case 'ControlLeft':
                    this.flyDown = false;
                    break;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
    }

    /**
     * 碰撞检测算法：检查当前位置是否与非透明方块重叠
     */
    private checkCollision(pos: THREE.Vector3): boolean {
        const r = this.playerRadius;
        const pMinX = pos.x - r, pMaxX = pos.x + r;
        const pMinY = pos.y - this.playerEyeHeight, pMaxY = pos.y + this.playerHeadClearance;
        const pMinZ = pos.z - r, pMaxZ = pos.z + r;

        // 遍历包围盒内可能覆盖的所有方块位置
        for (let x = Math.floor(pMinX); x <= Math.ceil(pMaxX); x++) {
            if (x + 0.5 <= pMinX || x - 0.5 >= pMaxX) continue;
            for (let y = Math.floor(pMinY); y <= Math.ceil(pMaxY); y++) {
                if (y + 0.5 <= pMinY || y - 0.5 >= pMaxY) continue;
                for (let z = Math.floor(pMinZ); z <= Math.ceil(pMaxZ); z++) {
                    if (z + 0.5 <= pMinZ || z - 0.5 >= pMaxZ) continue;

                    const block = this.world.getBlock(x, y, z);
                    // 仅当方块不是空气、水或植被时，才视为发生碰撞
                    if (block !== BlockType.AIR &&
                        block !== BlockType.WATER &&
                        block !== BlockType.TALL_GRASS &&
                        block !== BlockType.FLOWER) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 检查玩家是否浸没在水中
     */
    private checkInWater(pos: THREE.Vector3): boolean {
        const eyeX = Math.round(pos.x);
        const eyeY = Math.round(pos.y - 0.5);
        const eyeZ = Math.round(pos.z);
        return this.world.getBlock(eyeX, eyeY, eyeZ) === BlockType.WATER;
    }

    /**
     * 检查玩家是否在地面上（脚底下方是否有方块）
     */
    private checkGrounded(): boolean {
        if (this.isFlying) return false;
        const pos = this.camera.position.clone();
        pos.y -= 0.1;
        return this.checkCollision(pos);
    }

    /**
     * 每帧更新物理和运动状态
     */
    public update(delta: number) {
        // 桌面端要求指针锁定，移动端则始终更新
        if (!this.isMobile && !this.controls.isLocked) return;

        // 计算 X 和 Z 轴摩擦阻力
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        // 更新状态：是否在水里，是否在地面
        this.inWater = this.checkInWater(this.camera.position);
        if (!this.isFlying) {
            this.canJump = this.checkGrounded();
        }

        // 垂直移动逻辑
        if (this.isFlying) {
            this.velocity.y -= this.velocity.y * 15.0 * delta; // 飞行时的强阻尼
            const flySpeed = this.speed * 1.5;
            if (this.flyUp) this.velocity.y += flySpeed * delta;
            if (this.flyDown) this.velocity.y -= flySpeed * delta;
        } else if (this.inWater) {
            this.velocity.x -= this.velocity.x * this.waterDrag * delta;
            this.velocity.z -= this.velocity.z * this.waterDrag * delta;
            this.velocity.y -= this.waterGravity * delta;
            this.velocity.y += 4.0 * delta; // 水中浮力模拟
        } else {
            this.velocity.y -= this.gravity * delta;
            this.velocity.y = Math.max(this.velocity.y, -30); // 终端速度限制
        }

        // 计算移动方向
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward) - this.joystickVector.y;
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft) + this.joystickVector.x;

        // 规范化向量，防止对角线移动过快
        if (this.direction.lengthSq() > 1) {
            this.direction.normalize();
        }

        const currentSpeed = this.speed;

        if (this.moveForward || this.moveBackward || Math.abs(this.joystickVector.y) > 0.05)
            this.velocity.z -= this.direction.z * currentSpeed * delta;
        if (this.moveLeft || this.moveRight || Math.abs(this.joystickVector.x) > 0.05)
            this.velocity.x -= this.direction.x * currentSpeed * delta;

        const pos = this.camera.position;
        const originalPos = pos.clone();

        // 提取摄像机的本地坐标轴向量（右侧和前方）
        const right = new THREE.Vector3();
        const forward = new THREE.Vector3();

        this.camera.getWorldDirection(forward);
        forward.y = 0; // 锁定水平移动，抬头或低头时不改变垂直速度
        forward.normalize();

        right.crossVectors(forward, this.camera.up).normalize();

        // 根据速度计算目标位移量
        const dx = right.x * (-this.velocity.x * delta) + forward.x * (-this.velocity.z * delta);
        const dz = right.z * (-this.velocity.x * delta) + forward.z * (-this.velocity.z * delta);
        const dy = this.velocity.y * delta;

        // 分别在三个轴向上进行碰撞测试，实现顺滑的贴墙滑动
        // X 轴测试
        pos.x += dx;
        if (this.checkCollision(pos)) {
            pos.x = originalPos.x;
            this.velocity.x = 0;
        }

        // Z 轴测试
        pos.z += dz;
        if (this.checkCollision(pos)) {
            pos.z = originalPos.z;
            this.velocity.z = 0;
        }

        // Y 轴测试 (非飞行模式)
        pos.y += dy;
        if (!this.isFlying && this.checkCollision(pos)) {
            pos.y = originalPos.y;
            this.velocity.y = 0;
            this.canJump = true;
        }
    }

    /**
     * 旋转摄像机（移动端触摸拖拽）
     */
    public rotateCamera(movementX: number, movementY: number) {
        this.euler.setFromQuaternion(this.camera.quaternion);

        this.euler.y -= movementX * 0.002;
        this.euler.x -= movementY * 0.002;

        // 限制俯仰角，防止反转
        this.euler.x = Math.max(this.PI_2 - Math.PI, Math.min(this.PI_2 - 0, this.euler.x));

        this.camera.quaternion.setFromEuler(this.euler);
    }

    /**
     * 切换飞行状态
     */
    public toggleFlight() {
        if (this.gameMode === 'creative') {
            this.isFlying = !this.isFlying;
            if (this.isFlying) this.velocity.y = 0;
        }
    }

    /**
     * 跳跃逻辑
     */
    public jump() {
        if (this.isFlying) {
            this.velocity.y = this.speed * 0.5;
        } else if (this.canJump) {
            this.velocity.y = this.jumpForce;
            this.canJump = false;
        }
    }
}
