import { useMemo } from 'react';

import { formatDuration, monthDayText, weekdayShort } from './usageFormat';

/**
 * [0.13.1] 统计页的「近 7 天」趋势柱。
 *
 * ## 为什么柱高不写死像素
 * 数据量级差得很远（轻用一天 10 分钟、重度一天 9 小时）。柱高按「当天 / 窗口内最高那天」
 * 归一，只回答「哪天多、哪天少」，不做绝对值刻度 —— 绝对值在柱下面那行合计里已经给了。
 *
 * ## `totalSec === null` 是「还没读到」，不是 0
 * **不许把未读的画成零柱**：那会让人以为那天没用手機。两者用 `data-pending` 分开，
 * 样式上是骨架条，不是一条贴地的空柱。
 */
export interface UsageTrendPoint {
  /** 本地日 yyyy-MM-dd */
  key: string;
  /** null = 还没读到这一天（加载中）；0 = 确实没有前台记录 */
  totalSec: number | null;
}

interface Props {
  points: readonly UsageTrendPoint[];
  selected: string;
  onSelect: (key: string) => void;
}

export function UsageTrend({ points, selected, onSelect }: Props) {
  const peak = useMemo(
    () => points.reduce((max, point) => Math.max(max, point.totalSec ?? 0), 0),
    [points],
  );

  return (
    <div className="m-usage-trend" role="group" aria-label="近七天应用使用">
      {points.map((point) => {
        const active = point.key === selected;
        const pending = point.totalSec == null;
        const sec = point.totalSec ?? 0;
        /* 最高那天占满轨道；其余按比例。0 秒不给高度（CSS 给一条 2px 的 muted 底） */
        const percent = peak > 0 && sec > 0 ? Math.max(4, Math.round((sec / peak) * 100)) : 0;
        return (
          <button
            key={point.key}
            type="button"
            className="m-usage-trend__col"
            data-active={active || undefined}
            aria-pressed={active}
            aria-label={`${monthDayText(point.key)} ${weekdayShort(point.key)} ${
              pending ? '读取中' : formatDuration(sec)
            }`}
            onClick={() => onSelect(point.key)}
          >
            <span className="m-usage-trend__track">
              <span
                className="m-usage-trend__bar"
                data-pending={pending || undefined}
                data-empty={!pending && sec === 0 ? '' : undefined}
                style={pending ? undefined : { height: `${percent}%` }}
              />
            </span>
            <span className="m-usage-trend__label">{weekdayShort(point.key).slice(1)}</span>
          </button>
        );
      })}
    </div>
  );
}
