/**
 * Timing — 设置 · 数据管理 · 备份行的**归属词表与时间格式**（V0.11.16）
 * -----------------------------------------------------------------------------
 * 「当条记录」那一行（`MdBackupSummaryLine`）与展开后的列表行（`MdSyncBackupCard`）
 * 必须说同一套话：归属词（`Obsidian 落点` / `云端落点` / `本地目录落点` / `归属未知`）
 * 两处各写一份，第一次改文案就会有「上面写云端落点、下面写 WebDAV 落点」的分叉。
 *
 * 时间用**手写补零**而不是 `toLocaleString`：`11-07 22:14` 这种紧凑形态是 PRD 4.6
 * 指定的，而不同平台的 `zh-CN` 输出在分隔符上并不一致（`/` 与 `-` 都出现过）。
 */
import type { MdBackupItem } from '../../types/domain';

/** 已知归属（`MdBackupItem.target` 的非 `null` 取值） */
export type KnownTarget = 'obsidian' | 'webdav' | 'folder';

export const TARGET_LABELS: Record<KnownTarget, string> = {
  obsidian: 'Obsidian 落点',
  webdav: '云端落点',
  folder: '本地目录落点',
};

/** 归属 → 人话。`null` 是老备份（文件名没有 `__` 前缀），列表与当条记录都说「归属未知」 */
export function targetLabel(target: MdBackupItem['target']): string {
  return target === null ? '归属未知' : TARGET_LABELS[target];
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `MM-DD HH:mm`（24 小时制）——**⑤ 唯一的时间格式**：折叠标题下那一行与展开后的列表行
 * 共用这一个函数。
 *
 * [QA F4] v0.11.16 首版这里有两个函数（`formatAtShort` / `formatAtFull`），于是同一个
 * 页面上出现两种时间：摘要行 `11-07 22:14`、列表行 `2026/11/07 22:14`。这本身就是缺陷，
 * 而且 `formatAtFull` 还偏离了 v0.11.15 的 `11/07 22:14`（PRD F4 要求逐字一致）。
 *
 * 为什么不回退到 `toLocaleString`：它随平台输出 `11-07` 或 `11/07`（zh-CN 在不同运行
 * 时就出现过两种分隔符），逐字一致根本做不到——这才是有意改掉它的原因。
 *
 * 行内不带年份不歧义：列表按日期分组、组标题带年份；摘要行说「最近」。
 */
export function formatAtShort(atMs: number): string {
  const at = new Date(atMs);
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
