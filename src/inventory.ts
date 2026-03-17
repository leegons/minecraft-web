import { BlockType } from './constants';

/**
 * 背包系统类：管理玩家拥有的方块数量及其增删
 */
export class Inventory {
    // 使用 Map 存储方块类型及其对应的数量
    private items: Map<BlockType, number> = new Map();

    /**
     * 添加物品到背包
     */
    add(type: BlockType, count = 1) {
        this.items.set(type, (this.items.get(type) ?? 0) + count);
    }

    /** 
     * 从背包移除物品
     * @returns 如果数量不足返回 false，否则返回 true
     */
    remove(type: BlockType, count = 1): boolean {
        const current = this.items.get(type) ?? 0;
        if (current < count) return false;
        const next = current - count;
        if (next === 0) this.items.delete(type); // 数量归零时删除键值对
        else this.items.set(type, next);
        return true;
    }

    /** 获取指定类型的物品数量 */
    get(type: BlockType): number {
        return this.items.get(type) ?? 0;
    }

    /** 检查是否拥有足够数量的物品 */
    has(type: BlockType, count = 1): boolean {
        return (this.items.get(type) ?? 0) >= count;
    }

    /** 序列化：转为 JSON 对象以便保存 */
    toJSON(): Record<string, number> {
        const obj: Record<string, number> = {};
        for (const [k, v] of this.items) obj[String(k)] = v;
        return obj;
    }

    /** 反序列化：从 JSON 对象加载背包数据 */
    fromJSON(obj: Record<string, number>) {
        this.items.clear();
        for (const [k, v] of Object.entries(obj)) {
            this.items.set(parseInt(k) as BlockType, v);
        }
    }

    /** 状态变更时的回调函数（用于通知 UI 组件刷新） */
    onChange?: () => void;

    private notify() {
        this.onChange?.();
    }

    /** 添加并同步通知状态变更 */
    addNotify(type: BlockType, count = 1) {
        this.add(type, count);
        this.notify();
    }

    /** 移除并同步通知状态变更 */
    removeNotify(type: BlockType, count = 1): boolean {
        const ok = this.remove(type, count);
        if (ok) this.notify();
        return ok;
    }
}
