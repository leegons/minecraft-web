// 区块配置
export const CHUNK_SIZE = 16;   // 区块在 X 和 Z 轴的尺寸
export const CHUNK_HEIGHT = 32; // 区块在 Y 轴的高度
export const BLOCK_SIZE = 1;    // 单个方块的单位边长

// 方块类型枚举定义
export const BlockType = {
    AIR: 0,         // 空气
    GRASS: 1,       // 草块
    DIRT: 2,        // 泥土
    STONE: 3,       // 石头
    WATER: 4,       // 水
    WOOD: 5,        // 原木
    LEAVES: 6,      // 叶子
    TALL_GRASS: 7,  // 高草
    FLOWER: 8,      // 花
    BEDROCK: 9,     // 基岩
} as const;
export type BlockType = typeof BlockType[keyof typeof BlockType];

// 游戏模式定义：创造模式、平坦模式、生存模式
export type GameMode = 'creative' | 'flat' | 'survival';
