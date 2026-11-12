import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 活动热力图卡的文案（四语言齐备，理由同 `copy.ts` 头注释：不往
 * `shared/i18n/generated/**` 的位置数组里插行）。
 *
 * 单独开一个文件而不是塞进 `copy.ts`：那个文件已经 260 行，逼近单文件 300 行的硬上限
 * （AGENTS.md），而这张卡的文字只有六条——挤在一起会为了过门禁去删别人的注释。
 */
export interface HeatmapCopy {
  title: string;
  empty: string;
  /** 卡头读数：**平均每周**合计（4 周平均之后，"近 4 周合计"会和趋势卡的口径打架） */
  total: (text: string) => string;
  /** 卡头显示的读数：exe 的 `meta(Heatmap)` 只写「近 4 周」（`widgets/mod.rs:159`） */
  meta: (weeks: number) => string;
  /** 一格的 title / 读屏文本：必须说出「周几 / 哪个小时 / 平均多久」——只有颜色对读屏是空白 */
  cell: (day: string, fromHour: number, text: string) => string;
  /** 整张图的 `aria-label`：覆盖几周 + 平均每周合计 + 最忙的时段 */
  summary: (weeks: number, total: string, peak: string | null) => string;
  legendLow: string;
  legendHigh: string;
  /** 「周三 14 点」这类时段说法，给 `summary` 拼最忙那一格 */
  peakCell: (day: string, hour: number) => string;
}

export const HEATMAP_COPY: Record<Locale, HeatmapCopy> = {
  "zh-CN": {
    title: "活动热力图",
    empty: "还没有足够活动：采集满一天后，作息轮廓会浮出来",
    total: (text) => `平均每周 ${text}`,
    meta: (weeks) => `近 ${weeks} 周`,
    cell: (day, fromHour, text) => `${day} ${fromHour}–${fromHour + 1} 点 平均 ${text}`,
    summary: (weeks, total, peak) => `近 ${weeks} 周的每小时活动热力图，平均每周 ${total}${peak ? `，最集中在${peak}` : ""}`,
    legendLow: "少",
    legendHigh: "多",
    peakCell: (day, hour) => `${day} ${hour} 点`,
  },
  "en-US": {
    title: "Activity heatmap",
    empty: "Not enough activity yet — the routine shows up after a full day",
    total: (text) => `${text} per week`,
    meta: (weeks) => `Last ${weeks} weeks`,
    cell: (day, fromHour, text) => `${day} ${fromHour}:00–${fromHour + 1}:00, ${text} on average`,
    summary: (weeks, total, peak) => `Hourly activity heatmap for the last ${weeks} weeks, ${total} per week${peak ? `, busiest at ${peak}` : ""}`,
    legendLow: "Less",
    legendHigh: "More",
    peakCell: (day, hour) => `${day} ${hour}:00`,
  },
  "ru-RU": {
    title: "Тепловая карта",
    empty: "Активности пока мало — картина появится после полного дня",
    total: (text) => `${text} в неделю`,
    meta: (weeks) => `Последние ${weeks} нед.`,
    cell: (day, fromHour, text) => `${day} ${fromHour}:00–${fromHour + 1}:00, в среднем ${text}`,
    summary: (weeks, total, peak) => `Почасовая активность за ${weeks} нед., ${total} в неделю${peak ? `, пик — ${peak}` : ""}`,
    legendLow: "Меньше",
    legendHigh: "Больше",
    peakCell: (day, hour) => `${day}, ${hour}:00`,
  },
  es: {
    title: "Mapa de calor",
    empty: "Aún no hay actividad suficiente: el perfil aparece tras un día completo",
    total: (text) => `${text} por semana`,
    meta: (weeks) => `Últimas ${weeks} sem.`,
    cell: (day, fromHour, text) => `${day} ${fromHour}:00–${fromHour + 1}:00, ${text} de media`,
    summary: (weeks, total, peak) => `Actividad por hora de las últimas ${weeks} semanas, ${total} por semana${peak ? `, máximo en ${peak}` : ""}`,
    legendLow: "Menos",
    legendHigh: "Más",
    peakCell: (day, hour) => `${day} ${hour}:00`,
  },
};
