/**
 * [0.13.2] 统计页的洞察句（1–2 条）。文案由 `usageInsights.ts` 算好，这里只排版。
 *
 * 空数组**不渲染任何占位**：没有值得说的就不说，不要用「暂无洞察」占一行高度。
 */
import type { Insight } from './usageInsights';

export function UsageInsightList({ items }: { items: readonly Insight[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-usage-insight">
      {items.map((item) => (
        <li key={item.text} data-tone={item.tone}>
          {item.text}
        </li>
      ))}
    </ul>
  );
}
