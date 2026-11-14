/**
 * 时间轴第二层：一个事项行下的「应用:chrome-分类:学习-9:30-11:00」。
 *
 * ## 为什么这一层是折叠的
 *
 * 卡片只有 S/M/L 三档（4/6/8 行），一层就占满了。默认收起、点行展开 ——
 * 展开态记在卡片的 state 里，不落盘（它不是偏好，是「我现在想看这一段」）。
 *
 * ## 分类名为什么不能直接用 `getCategoryToken`
 *
 * `getCategoryToken` 只认内置的 8 个分类键；`category_key` 在新模型里是**自由字符串**
 * （用户给事项写的「学习」「摸鱼」就是它本身）。用 token 表解析会把它们全部落到
 * `other`，界面上看起来「分类全是其他」——而数据其实是对的。
 * 所以：内置键走本地化表（运行时按 `uiText.categories` 里有没有这个键判断，
 * 不硬编码清单），`ext:` 前缀走自定义分类名，其余**原样显示**。
 */
import { useLocale, useLocaleText, type UiText } from "../../../shared/i18n/index.ts";
import { isExtendedCategory, resolveExtendedCategoryLabel } from "../../../shared/classification/categoryTokens.ts";
import type { ItemTimelineRow } from "../../../platform/persistence/attributionGateway.ts";
import { DASHBOARD_COPY } from "../copy.ts";

/** 第二层的一条：应用段，或「未采集」空档。 */
export interface ChildEntry {
  kind: "segment" | "gap";
  key: string;
  startMs: number;
  endMs: number;
  appName: string;
  categoryKey: string;
}

function clockOf(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * 把 `segments` 与 `gaps` 合成一条按时间排的列表（纯函数，导出是为了能单测）。
 *
 * 两件事不能省：
 * - **空档要占位**：不插空档，第二层的时段加起来就比第一层短，用户以为丢了时间；
 * - **按起点排**：`segments` 与 `gaps` 各自有序，但合起来必须重排，
 *   否则 11:00 的 chrome 会排在 11:00–11:30 的空档后面。
 */
export function buildChildEntries(row: ItemTimelineRow): ChildEntry[] {
  const entries: ChildEntry[] = [
    ...row.segments.map((segment, index) => ({
      kind: "segment" as const,
      key: `s${index}-${segment.startMs}`,
      startMs: segment.startMs,
      endMs: segment.endMs,
      appName: segment.appName || segment.appKey,
      categoryKey: segment.categoryKey,
    })),
    ...row.gaps.map((gap, index) => ({
      kind: "gap" as const,
      key: `g${index}-${gap.startMs}`,
      startMs: gap.startMs,
      endMs: gap.endMs,
      appName: "",
      categoryKey: "",
    })),
  ];
  return entries.sort((left, right) => left.startMs - right.startMs || left.key.localeCompare(right.key));
}

/** 分类键 → 显示名。规则见文件头。 */
export function categoryLabelOf(key: string, uiText: UiText): string {
  const normalized = key.trim();
  if (!normalized) return "";
  if (isExtendedCategory(normalized)) return resolveExtendedCategoryLabel(normalized, uiText);
  /* 运行时查表而不是硬编码内置清单：清单在四份语言包里各有一份，
     抄一份进代码就多一处会漂移的真源。 */
  const table = uiText.categories as unknown as Record<string, unknown>;
  const localized = table[normalized];
  return typeof localized === "string" ? localized : normalized;
}

interface Props {
  row: ItemTimelineRow;
}

export default function TimelineChildRows({ row }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const entries = buildChildEntries(row);

  return (
    <ul className="qp-timeline-children">
      {entries.map((entry) => {
        const range = copy.timelineRange(clockOf(entry.startMs), clockOf(entry.endMs));
        if (entry.kind === "gap") {
          return (
            <li key={entry.key} className="qp-timeline-child" data-gap="">
              <span className="qp-timeline-child-app">{copy.timelineUnmeasured(range)}</span>
            </li>
          );
        }
        const label = categoryLabelOf(entry.categoryKey, UI_TEXT);
        return (
          <li key={entry.key} className="qp-timeline-child">
            <span className="qp-timeline-child-app" title={entry.appName}>{entry.appName}</span>
            {label ? <span className="qp-timeline-child-category">{label}</span> : null}
            <span className="qp-timeline-child-range">{range}</span>
          </li>
        );
      })}
    </ul>
  );
}
