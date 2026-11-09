/**
 * Timing — 移动端记录页（Tab ③）
 * -----------------------------------------------------------------------------
 * 五档范围（`lib/time.RecordsRange`）：今天 / 本周 / 近七天 / 本月 / 往日。
 * 周以**周一 00:00** 起，与后端 `stats_summary` 同口径；**区间算法全部在 `lib/time`**，
 * 本页只负责选档位与展示，不自己拼时间。
 *
 * [V0.11.31] 原来只有「今天 / 本周」两档，主人要的「往期」在手机上根本点不到
 * （原话「把本周改为往期，可选择本周、近七天、本月、往日等」）。「往日」用系统原生
 * 日期控件选某一天——自己画日历要重做闰月 / 周首 / 长按翻页，收益只是一个更小的按钮。
 *
 * 总计与「按事项分布」只取 `stats_summary`（PRD §6 的唯一算法），明细取 `list_records`。
 *
 * 分布条的百分比用 `group.totalSec / totalSec`：两者都来自同一份 summary，
 * 不会出现「条加起来超过 100%」这种前端自算误差。
 *
 * 删除不做左滑（PRD §4 提到过），改成进编辑 Sheet 里点「删除」：
 * 左滑在 WebView 里要自己实现手势 + 位移阈值 + 回弹，收益是一个更短的路径，
 * 代价是一条可能误触的破坏性手势。这一条记在交付说明里。
 */
import { useEffect, useMemo, useState } from 'react';
import { useRecordsData } from '../../hooks/useRecordsData';
import { formatDuration, formatMinutes, formatRange } from '../../lib/format';
import { AlertIcon, EmptyDotIcon, iconStroke } from '../../lib/icons';
import {
  dateInputValue,
  parseDateInput,
  rangeHint,
  rangeLabel,
  startOfDay,
  type RecordsRange,
} from '../../lib/time';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { itemName, useItemStore } from '../../stores/itemStore';

/** 档位顺序就是主人念的顺序：先眼前，再放大，最后才是回头挑一天 */
const TABS: { key: RecordsRange; label: string }[] = [
  { key: 'day', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'last7', label: '近七天' },
  { key: 'month', label: '本月' },
  { key: 'date', label: '往日' },
];

export function RecordsPage() {
  const [range, setRange] = useState<RecordsRange>('day');
  /* 「往日」默认落在昨天：先看到一天有数据的区间，而不是一个空页面。
     值恒为某天 00:00（`startOfDay`），转成 `type="date"` 的字符串只是展示形态。 */
  const [picked, setPicked] = useState(() => startOfDay(Date.now() - 86_400_000));
  const today = useMemo(() => startOfDay(Date.now()), []);

  /* 只有「往日」需要基准日，其余档位传 undefined，钩子内部才取「此刻」——
     传 `Date.now()` 会每次 render 都变，把 `useMemo` 变成每帧重查一次库。 */
  const reference = range === 'date' ? picked : undefined;
  const { loading, error, totalSec, recordCount, groups, reload } = useRecordsData(range, reference);
  const nonce = useMobileUiStore((s) => s.recordsNonce);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const items = useItemStore((s) => s.items);

  /* 编辑 / 删除一条记录后自增信号：distribution 与明细都要重新按 summary 算 */
  useEffect(() => {
    if (nonce > 0) reload();
  }, [nonce, reload]);

  const label = rangeLabel(range, picked);
  const emptyText = `${label}还没有记录。`;

  return (
    <div className="m-records">
      <div className="m-seg m-seg--scroll" role="tablist" aria-label="记录范围">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={range === tab.key}
            className="m-seg__item"
            data-on={range === tab.key ? 'true' : 'false'}
            onClick={() => setRange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* [V0.11.31] 往日档：选哪一天就查哪一天。`max` 卡在今天——未来还没记录，
          让人一路翻到明年只会看到空页面。 */}
      {range === 'date' && (
        <label className="m-datepick">
          <span className="m-field__label">看哪一天</span>
          <input
            type="date"
            className="m-input"
            value={dateInputValue(picked)}
            max={dateInputValue(today)}
            onChange={(e) => {
              const next = parseDateInput(e.target.value);
              if (next != null) setPicked(next);
            }}
          />
        </label>
      )}

      <section className="m-total">
        <div>
          <span className="m-total__label">{label}总计</span>
          <strong className="m-total__value">{formatDuration(totalSec)}</strong>
        </div>
        <span className="m-total__meta">{recordCount} 条 · {formatMinutes(totalSec)}</span>
      </section>

      {loading ? (
        <p className="m-empty">正在读取…</p>
      ) : error ? (
        <div className="m-error" role="alert">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>{error}</span>
          <button type="button" className="m-btn m-btn--small" onClick={reload}>
            重试
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="m-empty m-empty--block">
          <EmptyDotIcon size={24} strokeWidth={iconStroke(24)} aria-hidden />
          <p>{emptyText}</p>
        </div>
      ) : (
        <>
          <section className="m-section">
            <header className="m-section__head">
              <h2 className="m-section__title">按事项分布</h2>
              <span className="m-section__meta">{groups.length} 个事项</span>
            </header>
            <ul className="m-dist">
              {groups.map((group) => {
                const pct = totalSec > 0 ? Math.round((group.totalSec / totalSec) * 100) : 0;
                return (
                  <li key={`dist-${group.itemId}`}>
                    <div className="m-dist__head">
                      <span className="m-dist__name">{group.name}</span>
                      <span className="m-dist__meta">
                        {formatMinutes(group.totalSec)} · {pct}%
                      </span>
                    </div>
                    <span className="m-dist__track">
                      <span className="m-dist__bar" style={{ width: `${pct}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="m-section">
            <header className="m-section__head">
              <h2 className="m-section__title">明细</h2>
              <span className="m-section__meta">
                {label} · 单页最多 100 条
              </span>
            </header>
            {groups.map((group) => (
              <div key={`grp-${group.itemId}`} className="m-detail">
                <p className="m-detail__title">
                  {group.name || itemName(items, group.itemId)}
                  <span className="m-detail__sum">{formatDuration(group.totalSec)}</span>
                </p>
                <ul className="m-list">
                  {group.records.map((record) => (
                    <li key={record.id}>
                      <button
                        type="button"
                        className="m-record"
                        onClick={() => openSheet({ kind: 'recordEdit', record })}
                      >
                        <span className="m-record__range">{formatRange(record.startedAt, record.endedAt)}</span>
                        {record.note && <span className="m-record__note">{record.note}</span>}
                        <span className="m-record__dur">{formatDuration(record.accumulatedSec)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}

      <p className="m-hint">{rangeHint(range)}</p>
    </div>
  );
}
