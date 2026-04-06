import * as THREE from 'three';

// 昼夜循环常量（全天循环所需秒数）
const DAY_LENGTH = 1200; // 20 分钟为一个完整的昼夜，与 Minecraft 一致

/**
 * 天空盒类：负责昼夜交替、太阳月亮运动、星空和动态云朵
 */
export class Sky {
    private scene: THREE.Scene;

    private sun: THREE.Sprite;
    private moon: THREE.Sprite;
    private clouds: THREE.Group[] = [];
    private stars: THREE.Points;
    private pivot: THREE.Object3D; // 太阳和月亮绕此中心点旋转

    public time = 0; // 0..1 代表一天的时间 (0=黎明, 0.25=正午, 0.5=黄昏, 0.75=午夜)

    // 预分配颜色对象，避免每帧 new THREE.Color() 导致 GC 压力
    private readonly _bgColor = new THREE.Color();
    private readonly _fogColor = new THREE.Color();

    // 不同时间点对应的天空和雾效颜色
    private readonly SKY_COLORS = [
        { t: 0.00, sky: 0xffa07a, fog: 0xff8c69 }, // 黎明
        { t: 0.15, sky: 0x87ceeb, fog: 0x87ceeb }, // 早晨
        { t: 0.25, sky: 0x4488ff, fog: 0x87ceeb }, // 正午
        { t: 0.45, sky: 0x87ceeb, fog: 0x87ceeb }, // 下午
        { t: 0.50, sky: 0xff7043, fog: 0xff6030 }, // 黄昏
        { t: 0.60, sky: 0x111133, fog: 0x111133 }, // 入夜
        { t: 0.75, sky: 0x050510, fog: 0x050510 }, // 午夜
        { t: 0.90, sky: 0x111133, fog: 0x111133 }, // 深夜
        { t: 1.00, sky: 0xffa07a, fog: 0xff8c69 }, // 回到黎明
    ];

    constructor(scene: THREE.Scene, _renderer: THREE.WebGLRenderer) {
        this.scene = scene;

        // --- 太阳 ---
        const sunTex = this.makeSunTexture();
        const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false });
        this.sun = new THREE.Sprite(sunMat);
        this.sun.scale.set(10, 10, 1);

        // --- 月亮 ---
        const moonTex = this.makeMoonTexture();
        const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false });
        this.moon = new THREE.Sprite(moonMat);
        this.moon.scale.set(8, 8, 1);

        // 轨道中心点（天体距离原点 60 个单位进行圆周运动）
        this.pivot = new THREE.Object3D();
        scene.add(this.pivot);

        this.sun.position.set(0, 60, 0);
        this.moon.position.set(0, -60, 0); // 月亮位于太阳的对面
        this.pivot.add(this.sun);
        this.pivot.add(this.moon);

        // --- 星空 ---
        const starPositions: number[] = [];
        for (let i = 0; i < 800; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            const r = 90 + Math.random() * 10; // 星星分布在较大的球面上
            starPositions.push(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, sizeAttenuation: true });
        this.stars = new THREE.Points(starGeo, starMat);
        scene.add(this.stars);

        // --- 云朵 ---
        this.spawnClouds();
    }

    /** 生成太阳纹理（径向渐变，带有光晕效果） */
    private makeSunTexture(): THREE.Texture {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d')!;
        const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,200,1)');
        grd.addColorStop(0.3, 'rgba(255,220,50,1)');
        grd.addColorStop(0.6, 'rgba(255,180,0,0.7)');
        grd.addColorStop(1, 'rgba(255,100,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    /** 生成月亮纹理（带有陨石坑效果） */
    private makeMoonTexture(): THREE.Texture {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d')!;
        const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
        grd.addColorStop(0, 'rgba(240,240,230,1)');
        grd.addColorStop(0.8, 'rgba(200,200,195,1)');
        grd.addColorStop(1, 'rgba(180,180,170,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 64, 64);
        // 绘制陨石坑
        const craters = [{ x: 20, y: 22, r: 5 }, { x: 40, y: 35, r: 4 }, { x: 30, y: 45, r: 3 }];
        for (const cr of craters) {
            ctx.beginPath();
            ctx.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(160,160,155,0.5)';
            ctx.fill();
        }
        return new THREE.CanvasTexture(c);
    }

    /** 生成云朵纹理（多个圆叠加形成的蓬松感） */
    private makeCloudTexture(): THREE.Texture {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 64;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const puffs = [
            { x: 20, y: 42, r: 18 },
            { x: 40, y: 35, r: 22 },
            { x: 65, y: 32, r: 24 },
            { x: 90, y: 36, r: 20 },
            { x: 108, y: 44, r: 16 },
        ];
        for (const p of puffs) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillRect(20, 44, 90, 16); // 底部稍微平整一些
        return new THREE.CanvasTexture(c);
    }

    /** 在世界中随机生成飘动的云 */
    private spawnClouds() {
        const cloudTex = this.makeCloudTexture();
        for (let i = 0; i < 12; i++) {
            const group = new THREE.Group();
            const scale = 4 + Math.random() * 6;
            const geo = new THREE.PlaneGeometry(scale * 2, scale);
            const mat = new THREE.MeshBasicMaterial({
                map: cloudTex,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                opacity: 0.85,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2; // 云平铺在空中
            group.add(mesh);
            group.position.set(
                (Math.random() - 0.5) * 120,
                30 + Math.random() * 5,
                (Math.random() - 0.5) * 120
            );
            group.userData.speed = 0.5 + Math.random() * 1.0;
            group.userData.dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            this.scene.add(group);
            this.clouds.push(group);
        }
    }

    /** 颜色线性插值辅助函数 (HEX -> RGB LERP -> HEX) */
    private lerpColor(a: number, b: number, t: number): number {
        const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
        const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
        return (
            (Math.round(ar + (br - ar) * t) << 16) |
            (Math.round(ag + (bg - ag) * t) << 8) |
            Math.round(ab + (bb - ab) * t)
        );
    }

    /** 根据当前时间获取经过平滑插值后的天空颜色和雾气颜色 */
    private getSkyFog(): { sky: number; fog: number } {
        const cols = this.SKY_COLORS;
        let prev = cols[cols.length - 1];
        for (let i = 0; i < cols.length; i++) {
            const cur = cols[i];
            if (this.time <= cur.t) {
                const span = cur.t - prev.t;
                const frac = span > 0 ? (this.time - prev.t) / span : 0;
                return {
                    sky: this.lerpColor(prev.sky, cur.sky, frac),
                    fog: this.lerpColor(prev.fog, cur.fog, frac),
                };
            }
            prev = cur;
        }
        return { sky: cols[0].sky, fog: cols[0].fog };
    }

    public getClockTime() {
        const totalHours = (this.time * 24 + 6) % 24;
        const hours = Math.floor(totalHours);
        const minutes = Math.floor((totalHours % 1) * 60);
        return { hours, minutes };
    }

    /** 每帧更新天空状态 */
    update(delta: number, playerPosition: THREE.Vector3) {
        this.time = (this.time + delta / DAY_LENGTH) % 1;
        const angle = this.time * Math.PI * 2;

        // 旋转太阳和月亮的轨道，并始终跟随玩家位置
        this.pivot.rotation.z = Math.PI / 2 - angle;
        this.pivot.position.copy(playerPosition);

        // 星星也跟随玩家移动，营造无限远的视觉感
        this.stars.position.copy(playerPosition);

        // 更新背景颜色和雾效
        const { sky, fog } = this.getSkyFog();
        this._bgColor.setHex(sky);
        this.scene.background = this._bgColor;
        if (this.scene.fog instanceof THREE.Fog) {
            this._fogColor.setHex(fog);
            this.scene.fog.color.copy(this._fogColor);
        }

        // 星星仅在夜晚可见（根据时间平滑改变透明度）
        const sunHeight = Math.sin(angle);
        const nightFactor = Math.max(0, -sunHeight);
        (this.stars.material as THREE.PointsMaterial).opacity = nightFactor;
        (this.stars.material as THREE.PointsMaterial).transparent = true;
        (this.sun.material as THREE.SpriteMaterial).opacity = Math.max(0.35, Math.max(0, sunHeight));
        (this.moon.material as THREE.SpriteMaterial).opacity = Math.max(0.15, nightFactor);

        // 云朵缓慢漂移，并实现循环滚动（到达边界后重新出现在对面）
        for (const cloud of this.clouds) {
            const speed: number = cloud.userData.speed;
            const dir: THREE.Vector3 = cloud.userData.dir;
            cloud.position.addScaledVector(dir, speed * delta);
            
            const dx = cloud.position.x - playerPosition.x;
            const dz = cloud.position.z - playerPosition.z;
            if (Math.abs(dx) > 65) cloud.position.x = playerPosition.x - Math.sign(dx) * 64;
            if (Math.abs(dz) > 65) cloud.position.z = playerPosition.z - Math.sign(dz) * 64;
        }

        // 根据时间计算光照强度（白天强，夜晚弱）
        const lightIntensity = 0.08 + Math.max(0, sunHeight) * 0.92;
        return lightIntensity;
    }
}
