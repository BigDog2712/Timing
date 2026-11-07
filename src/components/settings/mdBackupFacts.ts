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
 * `MM-DD HH:mm`（24 小时制）——折叠标题下那一行用。
 *
 * PRD F2 要求它与展开后列表第一条**同源同值**，所以这里带月份与日期：只显示时间的话，
 * 「最近那份」是三天前的备份时用户会以为它是今天的。
 */
export function formatAtShort(atMs: number): string {
  const at = new Date(atMs);
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** `YYYY/MM/DD HH:mm`——展开后列表行用（与 v0.11.15 逐字一致：多了年份好对照日期分组） */
export function formatAtFull(atMs: number): string {
  const at = new Date(atMs);
  const date = `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
