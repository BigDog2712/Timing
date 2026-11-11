/**
 * Timing — 设置 · 数据管理 · ⑤ 折叠标题下的「当条记录」（V0.11.16，PRD R11 / F2 / F3）
 * -----------------------------------------------------------------------------
 * 一行说清「最近那一份底是什么」：
 *
 * ```text
 * 最近：11-07 22:14 · 覆盖前备份 · 2026-11-07.md · 3.2 KB
 * ```
 *
 * 三条口径：
 * 1. **一次只显示最新一条**（读法 A，主理人裁决）：`items` 按 `atMs` 倒序的第 0 条；
 * 2. **空列表也不隐藏这一行**：显示 `还没有备份。`——否则标题下会突然少一行，折叠
 *    高度跟着跳（PRD F3 / 七节）；
 * 3. **与展开后的列表同源**：`list` 就是 `useBackupList` 那一份，不另拉、不另算
 *    （PRD F2 要求收起时那一行与列表第一条同值）。
 */
import { formatAtShort } from '../../services/host/mdBackupFacts';
import { formatBytes } from '../../services/host/mdSyncConfig';
import type { MdBackupList } from '../../services/host/useBackupList';

interface MdBackupSummaryLineProps {
  list: MdBackupList;
}

export function MdBackupSummaryLine({ list }: MdBackupSummaryLineProps) {
  const latest = list.latest;
  /* 「覆盖前备份」是固定词：本项目的备份只有一个产生点 */
  const text = latest
    ? `最近：${formatAtShort(latest.atMs)} · 覆盖前备份 · ${latest.source} · ${formatBytes(latest.bytes)}`
    : '还没有备份。';

  return <p className="sync__latest" title={latest?.name}>{text}</p>;
}
