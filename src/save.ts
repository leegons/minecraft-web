import type { GameMode } from './constants';
import type { Inventory } from './inventory';

/**
 * 存储相关的键名前缀，防止与同域名的其他应用冲突
 */
const PREFIX = 'mc_';
const CHUNK_PREFIX = PREFIX + 'chunk_'; // 区块数据前缀
const MODIFIED_KEY = PREFIX + 'modified_chunks'; // 已修改区块的索引键
const GAME_KEY = PREFIX + 'game'; // 游戏模式和背包数据键
const LAST_PLAYED_KEY = PREFIX + 'last_played';
const MODES: GameMode[] = ['creative', 'flat', 'survival'];

interface SaveData {
    mode: GameMode;
    inventory: Record<string, number>;
}

const pendingChunks: Map<string, Uint8Array> = new Map();
let flushTimer: number | null = null;
const SAVE_FLUSH_DELAY_MS = 300;

/** 
 * 追踪哪些区块被玩家修改过（只保存被修改的区块以节省空间）
 */
const modifiedChunksByMode = new Map<GameMode, Set<string>>();

for (const mode of MODES) {
    modifiedChunksByMode.set(mode, new Set(loadStoredArray(modeKey(MODIFIED_KEY, mode))));
}

function chunkKey(cx: number, cz: number) {
    return `${cx}_${cz}`;
}

function modeKey(base: string, mode: GameMode) {
    return `${base}_${mode}`;
}

function chunkStorageKey(mode: GameMode, chunkId: string) {
    return `${modeKey(CHUNK_PREFIX, mode)}_${chunkId}`;
}

function loadStoredArray(key: string): string[] {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as string[] : [];
    } catch {
        return [];
    }
}

function getModifiedChunks(mode: GameMode): Set<string> {
    let chunks = modifiedChunksByMode.get(mode);
    if (!chunks) {
        chunks = new Set();
        modifiedChunksByMode.set(mode, chunks);
    }
    return chunks;
}

function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flushPendingChunks();
    }, SAVE_FLUSH_DELAY_MS);
}

function flushPendingChunks() {
    if (pendingChunks.size === 0) return;

    for (const mode of MODES) {
        localStorage.setItem(modeKey(MODIFIED_KEY, mode), JSON.stringify([...getModifiedChunks(mode)]));
    }
    for (const [key, data] of pendingChunks) {
        localStorage.setItem(key, uint8ToBase64(data));
    }
    pendingChunks.clear();
}

/**
 * 存档管理对象：负责与 localStorage 进行交互
 */
export const Save = {
    /**
     * 保存区块数据：由玩家手动修改方块时触发
     */
    saveChunk(mode: GameMode, cx: number, cz: number, data: Uint8Array) {
        const key = chunkKey(cx, cz);
        getModifiedChunks(mode).add(key);
        pendingChunks.set(chunkStorageKey(mode, key), data.slice());
        scheduleFlush();
    },

    /**
     * 读取指定坐标的区块存档数据
     */
    loadChunk(mode: GameMode, cx: number, cz: number): Uint8Array | null {
        const raw = localStorage.getItem(chunkStorageKey(mode, chunkKey(cx, cz)));
        if (!raw) return null;
        return base64ToUint8(raw);
    },

    /**
     * 保存全局游戏状态（模式、背包等）
     */
    saveGame(mode: GameMode, inventory: Inventory) {
        const data: SaveData = { mode, inventory: inventory.toJSON() };
        localStorage.setItem(modeKey(GAME_KEY, mode), JSON.stringify(data));
        localStorage.setItem(LAST_PLAYED_KEY, mode);
    },

    /**
     * 读取全局游戏状态
     */
    loadGame(mode: GameMode): SaveData | null {
        const raw = localStorage.getItem(modeKey(GAME_KEY, mode));
        if (!raw) return null;
        try { return JSON.parse(raw) as SaveData; } catch { return null; }
    },

    loadLatestGame(): SaveData | null {
        const lastPlayed = localStorage.getItem(LAST_PLAYED_KEY) as GameMode | null;
        if (lastPlayed && this.hasSave(lastPlayed)) {
            return this.loadGame(lastPlayed);
        }

        for (const mode of MODES) {
            if (this.hasSave(mode)) {
                return this.loadGame(mode);
            }
        }

        return null;
    },

    /**
     * 清除所有存档数据（用于重置游戏）
     */
    clearAll() {
        if (flushTimer !== null) {
            window.clearTimeout(flushTimer);
            flushTimer = null;
        }
        pendingChunks.clear();
        for (const mode of MODES) {
            for (const key of getModifiedChunks(mode)) {
                localStorage.removeItem(chunkStorageKey(mode, key));
            }
            getModifiedChunks(mode).clear();
            localStorage.removeItem(modeKey(MODIFIED_KEY, mode));
            localStorage.removeItem(modeKey(GAME_KEY, mode));
        }
        localStorage.removeItem(LAST_PLAYED_KEY);
        localStorage.removeItem(MODIFIED_KEY);
        localStorage.removeItem(GAME_KEY);
    },

    /** 检查是否存在有效存档 */
    hasSave(mode: GameMode): boolean {
        return !!localStorage.getItem(modeKey(GAME_KEY, mode));
    },

    hasAnySave(): boolean {
        return MODES.some((mode) => this.hasSave(mode));
    },

    isChunkModified(mode: GameMode, cx: number, cz: number): boolean {
        return getModifiedChunks(mode).has(chunkKey(cx, cz));
    },

    flushPending() {
        if (flushTimer !== null) {
            window.clearTimeout(flushTimer);
            flushTimer = null;
        }
        flushPendingChunks();
    }
};

/**
 * 辅助函数：将 Uint8Array 区块数据转换为 Base64 字符串
 */
function uint8ToBase64(buf: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
    }
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

window.addEventListener('pagehide', () => {
    Save.flushPending();
});

window.addEventListener('beforeunload', () => {
    Save.flushPending();
});

export type { GameMode };
