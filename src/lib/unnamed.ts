/**
 * Timing — 「未命名这一笔」的口径（[V0.11.32]，纯函数，便于单测）
 * -----------------------------------------------------------------------------
 * 主人要求：**没想好名字也能直接开始计时**，结束的时候再补名字。
 *
 * 数据上没有"匿名记录"这种东西：每条 `time_records` 都挂在一个事项上，所以"未命名"
 * 落到系统事项「未归类」（`SYSTEM_ITEM_ID = 1`）名下。这一条口径必须只有一处定义，
 * 否则"什么算该问名字"会在三个调用点各长一套判断。
 */
import { SYSTEM_ITEM_ID } from '../types/domain';
import type { Item, TimeRecord } from '../types/domain';

/** 名字最长多少字：与后端 `models::constants::ITEM_NAME_MAX_LEN` 同值（超长回 `ITEM_NAME_TOO_LONG`）。 */
export const NAME_MAX_LEN = 60;

/**
 * 这条记录算不算「还没起名」。
 *
 * 只看归属：系统事项被后端保护，永远叫「未归类」，用户也没法把它改名——
 * 所以挂在这条上的记录就是"记了时长、没有名字"。
 */
export function isUnnamedRecord(record: Pick<TimeRecord, 'itemId'>): boolean {
  return record.itemId === SYSTEM_ITEM_ID;
}

/** 去掉首尾空白并按上限截断（后端会拒超长，前端先截到合法范围内）。 */
export function normalizeName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX_LEN);
}

/**
 * 按名字找已有事项（**先找再建**）。
 *
 * 没有这一条，同一件事会被建成「写周报」「写周报 」「写周报」三条：
 * 手机上敲名字时多按一下空格就会，而用户看到的是列表里莫名其妙多了一个。
 * 比较用去空白后的全等（不做模糊匹配：那会把「写周报」和「写周报给老板」并成一条）。
 */
export function matchItemByName(items: readonly Item[], raw: string): Item | null {
  const name = normalizeName(raw);
  if (name.length === 0) return null;
  return items.find((item) => item.name.trim() === name) ?? null;
}
