import type { GameMode } from './constants';
import type { Inventory } from './inventory';

/**
 * 存储相关的键名前缀，防止与同域名的其他应用冲突
 */
const PREFIX = 'mc_';
const CHUNK_PREFIX = PREFIX + 'chunk_'; // 区块数据前缀
const MODIFIED_KEY = PREFIX + 'modified_chunks'; // 已修改区块的索引键
const GAME_KEY = PREFIX + 'game'; // 游戏模式和背包数据键

interface SaveData {
    mode: GameMode;
    inventory: Record<string, number>;
}

/** 
 * 追踪哪些区块被玩家修改过（只保存被修改的区块以节省空间）
 */
const modifiedChunks: Set<string> = new Set(
    JSON.parse(localStorage.getItem(MODIFIED_KEY) ?? '[]')
);

function chunkKey(cx: number, cz: number) {
    return `${cx}_${cz}`;
}

/**
 * 存档管理对象：负责与 localStorage 进行交互
 */
export const Save = {
    /**
     * 保存区块数据：由玩家手动修改方块时触发
     */
    saveChunk(cx: number, cz: number, data: Uint8Array) {
        const key = chunkKey(cx, cz);
        modifiedChunks.add(key);
        // 保存已被修改区块的列表
        localStorage.setItem(MODIFIED_KEY, JSON.stringify([...modifiedChunks]));
        // 区块数据使用 Base64 编码后存储为字符串，以提高存储密度
        localStorage.setItem(CHUNK_PREFIX + key, uint8ToBase64(data));
    },

    /**
     * 读取指定坐标的区块存档数据
     */
    loadChunk(cx: number, cz: number): Uint8Array | null {
        const raw = localStorage.getItem(CHUNK_PREFIX + chunkKey(cx, cz));
        if (!raw) return null;
        return base64ToUint8(raw);
    },

    /**
     * 保存全局游戏状态（模式、背包等）
     */
    saveGame(mode: GameMode, inventory: Inventory) {
        const data: SaveData = { mode, inventory: inventory.toJSON() };
        localStorage.setItem(GAME_KEY, JSON.stringify(data));
    },

    /**
     * 读取全局游戏状态
     */
    loadGame(): SaveData | null {
        const raw = localStorage.getItem(GAME_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw) as SaveData; } catch { return null; }
    },

    /**
     * 清除所有存档数据（用于重置游戏）
     */
    clearAll() {
        for (const key of modifiedChunks) {
            localStorage.removeItem(CHUNK_PREFIX + key);
        }
        modifiedChunks.clear();
        localStorage.removeItem(MODIFIED_KEY);
        localStorage.removeItem(GAME_KEY);
    },

    /** 检查是否存在有效存档 */
    hasSave(): boolean {
        return !!localStorage.getItem(GAME_KEY);
    }
};

/**
 * 辅助函数：将 Uint8Array 区块数据转换为 Base64 字符串
 */
function uint8ToBase64(buf: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return btoa(binary);
}

/**
 * 辅助函数：将 Base64 字符串还原为 Uint8Array
 */
function base64ToUint8(str: string): Uint8Array {
    const binary = atob(str);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf;
}

export type { GameMode };
