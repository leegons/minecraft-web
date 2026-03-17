import * as THREE from 'three';

/**
 * 使用 Canvas API 动态创建一个 16x16 的像素风格纹理
 * @param generatePixels 绘图回调函数
 */
function createCanvasTexture(generatePixels: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        generatePixels(ctx, 16, 16);
    }

    const texture = new THREE.CanvasTexture(canvas);
    // 使用 NearestFilter 以获得清晰的像素锯齿效果，而不是模糊插值
    texture.magFilter = THREE.NearestFilter; 
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * 颜色波动助手：在基础颜色上叠加随机抖动，使材质看起来更自然、更有质感
 */
function noiseColor(baseR: number, baseG: number, baseB: number, variance: number) {
    const v = (Math.random() * variance * 2) - variance;
    return `rgb(${Math.max(0, Math.min(255, baseR + v))}, ${Math.max(0, Math.min(255, baseG + v))}, ${Math.max(0, Math.min(255, baseB + v))})`;
}

/**
 * 游戏纹理集：通过程序化方式生成所有方块的外观
 */
export const textures = {
    // 泥土：深褐色背景，带随机噪点
    dirt: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                ctx.fillStyle = noiseColor(139, 90, 43, 20); 
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 草地顶部：纯绿色像素
    grassTop: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                ctx.fillStyle = noiseColor(85, 170, 85, 20); 
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 草地侧面：上部是草的绿色，下部是泥土的褐色，交界处随机过渡
    grassSide: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                if (y < 4 || (y < 8 && Math.random() > 0.5)) {
                    ctx.fillStyle = noiseColor(85, 170, 85, 20); // 草色
                } else {
                    ctx.fillStyle = noiseColor(139, 90, 43, 20); // 泥土色
                }
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 石头：不同亮度的灰色像素
    stone: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                ctx.fillStyle = noiseColor(136, 136, 136, 30); 
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 原木侧面：带有垂直条纹效果
    wood: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                const grain = (x % 4 < 2) ? 10 : -10;
                ctx.fillStyle = noiseColor(120 + grain, 80 + grain, 40 + grain, 10);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 原木切面：带有年轮效果
    woodTop: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                const cx2 = x - w / 2;
                const cy2 = y - h / 2;
                const dist = Math.sqrt(cx2 * cx2 + cy2 * cy2);
                const ring = Math.floor(dist) % 3 === 0 ? -15 : 0;
                ctx.fillStyle = noiseColor(120 + ring, 80 + ring, 40 + ring, 8);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 树叶：深浅不一的绿色
    leaves: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                if (Math.random() > 0.15) {
                    ctx.fillStyle = noiseColor(60, 140, 50, 25);
                } else {
                    ctx.fillStyle = noiseColor(40, 110, 35, 15);
                }
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }),
    // 长草：在透明背景上绘制随机高度和弧度的草苗
    tallGrass: createCanvasTexture((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h); 
        for (let i = 0; i < 6; i++) {
            const startX = Math.random() * w;
            const endX = startX + (Math.random() - 0.5) * 8;
            const height = h * 0.4 + Math.random() * h * 0.5;

            ctx.beginPath();
            ctx.moveTo(startX, h);
            ctx.quadraticCurveTo(startX, h - height / 2, endX, h - height);
            ctx.lineWidth = 1 + Math.random();
            ctx.strokeStyle = noiseColor(40, 150 + Math.random() * 50, 40, 10);
            ctx.stroke();
        }
    }),
    // 花：绘制花茎、叶子和不同颜色（红/黄）的花瓣
    flower: createCanvasTexture((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h); 
        ctx.fillStyle = '#2d8c36';
        ctx.fillRect(w / 2 - 1, h / 2, 2, h / 2);
        ctx.fillRect(w / 2 - 3, h * 0.75, 3, 2);
        ctx.fillRect(w / 2, h * 0.6, 4, 2);

        const isRed = Math.random() > 0.5;
        const mainColor = isRed ? '#e74c3c' : '#f1c40f';
        const centerColor = isRed ? '#f1c40f' : '#e67e22';

        ctx.fillStyle = mainColor;
        ctx.fillRect(w / 2 - 4, h / 2 - 6, 8, 4);
        ctx.fillRect(w / 2 - 2, h / 2 - 8, 4, 8);

        ctx.fillStyle = centerColor;
        ctx.fillRect(w / 2 - 1, h / 2 - 5, 2, 2);
    }),
    // 基岩：深色网格纹理
    bedrock: createCanvasTexture((ctx, w, h) => {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                ctx.fillStyle = noiseColor(50, 50, 50, 10);
                ctx.fillRect(x, y, 1, 1);
            }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        for (let i = 0; i < w; i += 4) {
            ctx.fillRect(i, 0, 1, h);
            ctx.fillRect(0, i, w, 1);
        }
    }),
};

import { BlockType } from './constants';

/**
 * 材质库：将方块类型映射到 Three.js 材质
 * 某些方块（如草地和木材）在立方体的不同面上使用不同的纹理
 */
export const blockMaterials = {
    [BlockType.DIRT]: new THREE.MeshLambertMaterial({ map: textures.dirt }),
    [BlockType.STONE]: new THREE.MeshLambertMaterial({ map: textures.stone }),
    [BlockType.GRASS]: [
        new THREE.MeshLambertMaterial({ map: textures.grassSide }), // 右 (+X)
        new THREE.MeshLambertMaterial({ map: textures.grassSide }), // 左 (-X)
        new THREE.MeshLambertMaterial({ map: textures.grassTop }),  // 上 (+Y)
        new THREE.MeshLambertMaterial({ map: textures.dirt }),      // 下 (-Y)
        new THREE.MeshLambertMaterial({ map: textures.grassSide }), // 前 (+Z)
        new THREE.MeshLambertMaterial({ map: textures.grassSide }), // 后 (-Z)
    ],
    [BlockType.WOOD]: [
        new THREE.MeshLambertMaterial({ map: textures.wood }),    
        new THREE.MeshLambertMaterial({ map: textures.wood }),    
        new THREE.MeshLambertMaterial({ map: textures.woodTop }), 
        new THREE.MeshLambertMaterial({ map: textures.woodTop }), 
        new THREE.MeshLambertMaterial({ map: textures.wood }),    
        new THREE.MeshLambertMaterial({ map: textures.wood }),    
    ],
    [BlockType.LEAVES]: new THREE.MeshLambertMaterial({ map: textures.leaves }),
    [BlockType.TALL_GRASS]: new THREE.MeshLambertMaterial({ map: textures.tallGrass, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }),
    [BlockType.FLOWER]: new THREE.MeshLambertMaterial({ map: textures.flower, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }),
    [BlockType.BEDROCK]: new THREE.MeshLambertMaterial({ map: textures.bedrock }),
};
