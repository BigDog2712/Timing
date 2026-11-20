import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 活动热力图卡的文案（四语言齐备，理由同 `copy.ts` 头注释：不往
 * `shared/i18n/generated/**` 的位置数组里插行）。
 *
 * [2026-11-20] 轴换了：横轴是日期、纵轴是 6 个四小时段 + 当日合计。文案跟着改口径，
 * 不再有"平均每周"。
 */
export interface HeatmapCopy {
  title: string;
  empty: string;
  /** 卡头读数：本月合计 */
  meta: (text: string) => string;
  /** 时段格的 title / 读屏文本：日期 + 时段 + 时长 */
  cell: (day: string, range: string, text: string) => string;
  /** 合计行一格的 title / 读屏文本 */
  totalCell: (day: string, text: string) => string;
  /** 整张图的 `aria-label`：覆盖哪个月 + 合计 + 最忙的一天 */
  summary: (month: string, total: string, peak: string | null) => string;
  legendLow: string;
  legendHigh: string;
  /** 月导航的 group 标签与两颗箭头的读屏名 */
  rangeLabel: string;
  previousMonth: string;
  nextMonth: string;
  /** 纵轴第一行（当天合计）的标签 */
  totalRow: string;
}

export const HEATMAP_COPY: Record<Locale, HeatmapCopy> = {
  "zh-CN": {
    title: "活动热力图",
    empty: "本月还没有记录活动：开始计时后，每天的时段热力会浮出来",
    meta: (text) => `合计 ${text}`,
    cell: (day, range, text) => `${day} ${range} 点 ${text}`,
    totalCell: (day, text) => `${day} 合计 ${text}`,
    summary: (month, total, peak) => `${month}的活动热力图，合计 ${total}${peak ? `，最忙的是 ${peak}` : ""}`,
    legendLow: "少",
    legendHigh: "多",
    rangeLabel: "热力图月份",
    previousMonth: "上一个月",
    nextMonth: "下一个月",
    totalRow: "day",
  },
  "en-US": {
    title: "Activity heatmap",
    empty: "No activity recorded this month yet — start tracking and the daily blocks appear",
    meta: (text) => `Total ${text}`,
    cell: (day, range, text) => `${day} ${range}, ${text}`,
    totalCell: (day, text) => `${day}, total ${text}`,
    summary: (month, total, peak) => `Activity heatmap for ${month}, total ${total}${peak ? `, busiest on ${peak}` : ""}`,
    legendLow: "Less",
    legendHigh: "More",
    rangeLabel: "Heatmap month",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    totalRow: "day",
  },
  "ru-RU": {
    title: "Тепловая карта",
    empty: "В этом месяце активности пока нет — начните учёт, и блоки появятся",
    meta: (text) => `Всего ${text}`,
    cell: (day, range, text) => `${day} ${range}, ${text}`,
    totalCell: (day, text) => `${day}, всего ${text}`,
    summary: (month, total, peak) => `Тепловая карта активности за ${month}, всего ${total}${peak ? `, самый активный день — ${peak}` : ""}`,
    legendLow: "Меньше",
    legendHigh: "Больше",
    rangeLabel: "Месяц тепловой карты",
    previousMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    totalRow: "день",
  },
  es: {
    title: "Mapa de calor",
    empty: "Aún no hay actividad este mes: empieza a registrar y aparecerán los bloques",
    meta: (text) => `Total ${text}`,
    cell: (day, range, text) => `${day} ${range}, ${text}`,
    totalCell: (day, text) => `${day}, total ${text}`,
    summary: (month, total, peak) => `Mapa de calor de actividad de ${month}, total ${total}${peak ? `, día más activo: ${peak}` : ""}`,
    legendLow: "Menos",
    legendHigh: "Más",
    rangeLabel: "Mes del mapa de calor",
    previousMonth: "Mes anterior",
    nextMonth: "Mes siguiente",
    totalRow: "día",
  },
};