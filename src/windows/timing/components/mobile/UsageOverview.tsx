/**
 * [0.13.2] 统计页的总览卡：一个主读数 + 一条对比 + 两三个副读数。
 *
 * 主读数只有**一个**（合计），副读数最多三个，全部由调用方算好传进来 ——
 * 这一层不认识数据形状，只负责排版。为什么重要：同一张卡里两个读数各自取数
 * 就会同屏打架（0.12.2 计时分布卡的教训），所以这里只做「显示」。
 */
import { formatDuration, formatSpanCN } from './usageFormat';

interface Detail {
  label: string;
  value: string;
}

interface Props {
  headline: string;
  totalSec: number;
  /** 与昨天比（秒）。`null` = 没读到昨天，**不显示对比**（不显示「持平」） */
  deltaSec?: number | null;
  details: readonly Detail[];
}

export function UsageOverview({ headline, totalSec, deltaSec, details }: Props) {
  const delta = deltaSec ?? null;
  return (
    <div className="m-usage-overview">
      <span className="m-usage-overview__headline">{headline}</span>
      <div className="m-usage-overview__main">
        <span className="m-usage-overview__total">{formatDuration(totalSec)}</span>
        {delta != null && Math.abs(delta) >= 60 ? (
          <span className="m-usage-overview__delta" data-tone={delta > 0 ? 'up' : 'down'}>
            {delta > 0 ? '↑' : '↓'} {formatSpanCN(Math.abs(delta))}
          </span>
        ) : null}
      </div>
      {details.length > 0 ? (
        <dl className="m-usage-overview__meta">
          {details.map((item) => (
            <div key={item.label} className="m-usage-overview__cell">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
