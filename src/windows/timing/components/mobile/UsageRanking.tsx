/**
 * [0.13.2] 统计页的应用排行：每行 = 一行头（名字 + 时长）+ 一条占比 + 一行脚注。
 *
 * ## 为什么条长按「本列表第一条」归一，而占比按合计算
 * 两者回答不同问题：条长让眼睛分辨「谁多谁少」（相对最高那条），占比回答「这一天里它占几成」
 * （相对合计）。混用会得到「条满格但只占 12%」这种自相矛盾的卡。
 *
 * ## 「其他 N 个应用」不是应用
 * 超过 10 条时列表尾部合成一行，它**不可点**（点开一个聚合体没有详情可看），
 * 但也必须显示时长 —— 少了它，列表之和就不等于顶部合计，用户对不上账。
 */
import { formatDuration, shortName } from './usageFormat';
import { percentOf, type UsageRow } from '../../services/usageRange';

interface Props {
  top: readonly UsageRow[];
  /** 尾部聚合行（`topRows` 的第二个回值）；没有就传 null */
  rest: UsageRow | null;
  totalSec: number;
  /** 每行脚注（单日 = 首末时刻 / 区间 = 出现天数） */
  meta: (row: UsageRow) => string;
  onSelect: (packageName: string) => void;
}

export function UsageRanking({ top, rest, totalSec, meta, onSelect }: Props) {
  const peak = top.reduce((max, row) => Math.max(max, row.sec), 0);
  const widthOf = (sec: number) =>
    peak > 0 && sec > 0 ? Math.max(4, Math.round((sec / peak) * 100)) : 0;

  return (
    <ul className="m-usage__list">
      {top.map((row) => (
        <li key={row.packageName}>
          <button
            type="button"
            className="m-usage__row"
            onClick={() => onSelect(row.packageName)}
            aria-label={`${shortName(row.packageName)} ${formatDuration(row.sec)}，查看每日趋势`}
          >
            <span className="m-usage__rowhead">
              <span className="m-usage__name">{shortName(row.packageName)}</span>
              <span className="m-usage__sec">{formatDuration(row.sec)}</span>
            </span>
            <span className="m-usage__bar" aria-hidden="true">
              <span className="m-usage__bar-fill" style={{ width: `${widthOf(row.sec)}%` }} />
            </span>
            <span className="m-usage__meta">
              <span>{meta(row)}</span>
              <span>{percentOf(row.sec, totalSec)}%</span>
            </span>
          </button>
        </li>
      ))}
      {rest != null ? (
        <li>
          <div className="m-usage__row" data-static="">
            <span className="m-usage__rowhead">
              <span className="m-usage__name">{rest.packageName}</span>
              <span className="m-usage__sec">{formatDuration(rest.sec)}</span>
            </span>
            <span className="m-usage__bar" aria-hidden="true">
              <span className="m-usage__bar-fill" style={{ width: `${widthOf(rest.sec)}%` }} />
            </span>
            <span className="m-usage__meta">
              <span>{rest.days > 1 ? `出现 ${rest.days} 天` : '合计'}</span>
              <span>{percentOf(rest.sec, totalSec)}%</span>
            </span>
          </div>
        </li>
      ) : null}
    </ul>
  );
}
