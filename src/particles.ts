import * as THREE from 'three';

const MAX_PARTICLES = 1000;
const DURATION = 1.0; // 粒子持续时间（秒）

// 描述单个粒子的物理学和颜色状态
interface Particle {
    active: boolean;    // 是否处于活动状态
    pos: THREE.Vector3; // 位置
    vel: THREE.Vector3; // 速度向量
    rot: THREE.Euler;   // 旋转角度
    rotVel: THREE.Vector3; // 旋转角速度
    life: number;       // 剩余生命时间
    color: THREE.Color; // 颜色
}

/**
 * 粒子系统类：使用 InstancedMesh 高效管理大量方块碎屑粒子
 */
export class ParticleSystem {
    private scene: THREE.Scene;
    private mesh: THREE.InstancedMesh;
    private particles: Particle[] = [];
    private dummy = new THREE.Object3D(); // 用于矩阵变换的中间对象
    private colorCache = new THREE.Color();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        // 创建极小的方块形状作为粒子原型
        const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });

        // 使用 InstancedMesh 仅需一次绘制调用即可渲染 1000 个物体
        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0; // 初始时不显示任何粒子

        scene.add(this.mesh);

        // 预分配粒子池，避免运行时频繁创建对象导致垃圾回收卡顿
        for (let i = 0; i < MAX_PARTICLES; i++) {
            this.particles.push({
                active: false,
                pos: new THREE.Vector3(),
                vel: new THREE.Vector3(),
                rot: new THREE.Euler(),
                rotVel: new THREE.Vector3(),
                life: 0,
                color: new THREE.Color()
            });
        }
    }

    /**
     * 在指定位置生成挖掘碎屑粒子
     * @param x, y, z 生成坐标
     * @param colorHex 方块碎屑的基础颜色
     */
    public breakBlock(x: number, y: number, z: number, colorHex: number) {
        const count = 10 + Math.floor(Math.random() * 10); // 随机生成 10-20 个粒子
        let spawned = 0;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particles[i];
            if (!p.active) {
                p.active = true;
                // 在方块中心周围随机散布初始位置
                p.pos.set(
                    x + Math.random() - 0.5,
                    y + Math.random() - 0.5,
                    z + Math.random() - 0.5
                );
                // 给粒子一个爆发式的离心速度
                p.vel.set(
                    (p.pos.x - x) * 6,
                    (Math.random() * 4) + 2, // 向上的爆发力
                    (p.pos.z - z) * 6
                );
                // 随机旋转状态和角速度
                p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                p.rotVel.set(
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10
                );
                p.life = DURATION * (0.5 + Math.random() * 0.5);

                // 根据基础色增加轻微的明暗变化，使碎屑看起来更真实
                this.colorCache.setHex(colorHex);
                const shade = 1.0 - Math.random() * 0.2; 
                this.colorCache.multiplyScalar(shade);
                p.color.copy(this.colorCache);

                spawned++;
                if (spawned >= count) break;
            }
        }
    }

    /**
     * 每帧更新：处理重力、位移并同步到 InstancedMesh
     */
    public update(delta: number) {
        let activeCount = 0;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particles[i];
            if (p.active) {
                p.life -= delta;
                if (p.life <= 0) {
                    p.active = false;
                    continue;
                }

                // 应用重力加速度
                p.vel.y -= 15 * delta;

                // 更新位置和线性位移
                p.pos.addScaledVector(p.vel, delta);

                // 更新旋转角度
                p.rot.x += p.rotVel.x * delta;
                p.rot.y += p.rotVel.y * delta;
                p.rot.z += p.rotVel.z * delta;

                // 同步数据到临时 dummy 对象进行矩阵变换
                this.dummy.position.copy(p.pos);
                this.dummy.rotation.copy(p.rot);
                
                // 粒子在其生命周期结束前会逐渐变小直至消失
                const scale = Math.max(0, p.life / DURATION);
                this.dummy.scale.set(scale, scale, scale);
                this.dummy.updateMatrix();

                // 更新 InstancedMesh 中对应索引的矩阵和颜色
                this.mesh.setMatrixAt(activeCount, this.dummy.matrix);
                this.mesh.setColorAt(activeCount, p.color);

                activeCount++;
            }
        }

        // 修改 mesh 的显示数量，并标记属性需要提交到显存
        this.mesh.count = activeCount;
        if (activeCount > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) {
                this.mesh.instanceColor.needsUpdate = true;
            }
        }
    }

    public dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) {
            this.mesh.material.dispose();
        }
    }
}
