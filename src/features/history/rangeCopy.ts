import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 历史页区间视图的**新文案表**（四语言齐备）。
 *
 * 为什么不进 `src/shared/i18n/**`（与 `dashboard/copy.ts` 同一条理由，见该文件头注）：
 * 四个 locale 文件是按索引对齐的**位置数组**，手插一行会让其后全部文案错位；
 * `generated/contract.ts` 还在 `scripts/size-allowlist.json` 里冻结在 1131/1131 行，
 * 加一个键就涨一行、撞棘轮。所以新文案一律组件侧自有，且必须 `Record<Locale, …>`
 * **四键齐全**——不许写 `locale.startsWith("zh") ? … : …` 那种两档写法（ru/es 会静默降级）。
 *
 * 已有的键照旧走 `useLocaleText()`：`data.pastSevenDays` / `data.pastThirtyDays` /
 * `data.rangePickerTitle` / `data.pickStartDate` / `data.pickEndDate` / `data.applyRange` /
 * `common.readFailed` / `common.retry` / `date.weekdaysShort` 全部复用，不进本表。
 */
export interface HistoryRangeCopy {
  /** 档位 chip（同时也是范围标签：昨日/本周的 chip 与标签同词，custom 才不同） */
  modeDay: string;
  modeYesterday: string;
  modeWeek: string;
  modeLast7: string;
  modeLast30: string;
  modeCustom: string;
  yesterday: string;
  thisWeek: string;
  last7: string;
  last30: string;
  customRange: (startDateKey: string, endDateKey: string, dayCount: number) => string;
  /** 档位条的读屏名 */
  rangeModeAria: string;
  /** 四格摘要 */
  summaryActivity: string;
  summaryTiming: string;
  summaryNotes: string;
  summaryTodos: string;
  /** 四块正文标题 */
  appsTitle: string;
  itemsTitle: string;
  notesTitle: string;
  todosTitle: string;
  appsEmpty: string;
  itemsEmpty: string;
  notesEmpty: string;
  todosEmpty: string;
  dailyTitle: string;
  dailyHint: string;
  /** 逐日时间轴（一行一天） */
  timelineTitle: string;
  timelineHint: string;
  timelineEmpty: string;
  timelineLaneAria: (dateLabel: string, spanLabel: string, appCount: number) => string;
  /** 逐日柱的读屏名：点它 = 跳那天的单日视图 */
  openDay: (dateLabel: string, durationLabel: string) => string;
  unnamedItem: string;
  noteOnItem: (itemName: string) => string;
  todoPlanned: (dateLabel: string) => string;
  /** 排行行尾的「N 条」/占比 */
  itemRecordCount: (count: number) => string;
  loading: string;
  /** 区间读不到数据时的整块文案（区间比单日更容易撞上半就绪的库） */
  readFailed: string;
}

export const HISTORY_RANGE_COPY: Record<Locale, HistoryRangeCopy> = {
  "zh-CN": {
    modeDay: "单日",
    modeYesterday: "昨日",
    modeWeek: "本周",
    modeLast7: "近 7 天",
    modeLast30: "近 30 天",
    modeCustom: "自定义",
    yesterday: "昨日",
    thisWeek: "本周",
    last7: "近 7 天",
    last30: "近 30 天",
    customRange: (start, end, days) => `${start} ~ ${end} · ${days} 天`,
    rangeModeAria: "历史范围",
    summaryActivity: "活跃时长",
    summaryTiming: "事项时长",
    summaryNotes: "便利贴",
    summaryTodos: "待办完成",
    appsTitle: "应用分布",
    itemsTitle: "事项分布",
    notesTitle: "便利贴",
    todosTitle: "已完成待办",
    appsEmpty: "这段时间没有应用记录",
    itemsEmpty: "这段时间没有计时记录",
    notesEmpty: "这段时间没有新便利贴",
    todosEmpty: "这段时间没有完成待办",
    dailyTitle: "逐日活动",
    dailyHint: "点某一天查看单日时间轴",
    timelineTitle: "时间轴",
    timelineHint: "每行一天 · 空白是没有记录",
    timelineEmpty: "这段时间没有应用记录",
    timelineLaneAria: (dateLabel, spanLabel, appCount) => `查看 ${dateLabel} 的时间轴（${spanLabel}，${appCount} 个应用）`,
    openDay: (dateLabel, durationLabel) => `查看 ${dateLabel} 的单日记录（${durationLabel}）`,
    unnamedItem: "未命名计时",
    noteOnItem: (itemName) => `挂在「${itemName}」`,
    todoPlanned: (dateLabel) => `原定 ${dateLabel}`,
    itemRecordCount: (count) => `${count} 条`,
    loading: "正在统计…",
    readFailed: "这段时间的数据没有读出来",
  },
  "en-US": {
    modeDay: "Day",
    modeYesterday: "Yesterday",
    modeWeek: "This week",
    modeLast7: "Last 7 days",
    modeLast30: "Last 30 days",
    modeCustom: "Custom",
    yesterday: "Yesterday",
    thisWeek: "This week",
    last7: "Last 7 days",
    last30: "Last 30 days",
    customRange: (start, end, days) => `${start} ~ ${end} · ${days} days`,
    rangeModeAria: "History range",
    summaryActivity: "Active time",
    summaryTiming: "Tracked time",
    summaryNotes: "Notes",
    summaryTodos: "To-dos done",
    appsTitle: "App breakdown",
    itemsTitle: "Item breakdown",
    notesTitle: "Notes",
    todosTitle: "Completed to-dos",
    appsEmpty: "No app activity in this range",
    itemsEmpty: "No tracked time in this range",
    notesEmpty: "No notes written in this range",
    todosEmpty: "No to-dos completed in this range",
    dailyTitle: "Daily activity",
    dailyHint: "Pick a day to open its timeline",
    timelineTitle: "Timeline",
    timelineHint: "One row per day · gaps mean no activity",
    timelineEmpty: "No app activity in this range",
    timelineLaneAria: (dateLabel, spanLabel, appCount) => `Open the ${dateLabel} timeline (${spanLabel}, ${appCount} apps)`,
    openDay: (dateLabel, durationLabel) => `Open ${dateLabel} (${durationLabel})`,
    unnamedItem: "Untitled timing",
    noteOnItem: (itemName) => `On “${itemName}”`,
    todoPlanned: (dateLabel) => `Planned ${dateLabel}`,
    itemRecordCount: (count) => `${count} entries`,
    loading: "Measuring…",
    readFailed: "Could not read this range",
  },
  "ru-RU": {
    modeDay: "День",
    modeYesterday: "Вчера",
    modeWeek: "Эта неделя",
    modeLast7: "7 дней",
    modeLast30: "30 дней",
    modeCustom: "Период",
    yesterday: "Вчера",
    thisWeek: "Эта неделя",
    last7: "Последние 7 дней",
    last30: "Последние 30 дней",
    customRange: (start, end, days) => `${start} ~ ${end} · ${days} дн.`,
    rangeModeAria: "Диапазон истории",
    summaryActivity: "Активное время",
    summaryTiming: "Время по делам",
    summaryNotes: "Заметки",
    summaryTodos: "Задачи готовы",
    appsTitle: "По приложениям",
    itemsTitle: "По делам",
    notesTitle: "Заметки",
    todosTitle: "Выполненные задачи",
    appsEmpty: "За этот период активности нет",
    itemsEmpty: "За этот период нет записей таймера",
    notesEmpty: "За этот период заметок нет",
    todosEmpty: "За этот период задачи не выполнялись",
    dailyTitle: "По дням",
    dailyHint: "Нажмите день, чтобы открыть его шкалу",
    timelineTitle: "Шкала",
    timelineHint: "Строка = день · пробел = нет записей",
    timelineEmpty: "За этот период активности нет",
    timelineLaneAria: (dateLabel, spanLabel, appCount) => `Шкала ${dateLabel} (${spanLabel}, приложений: ${appCount})`,
    openDay: (dateLabel, durationLabel) => `Открыть ${dateLabel} (${durationLabel})`,
    unnamedItem: "Без названия",
    noteOnItem: (itemName) => `К делу «${itemName}»`,
    todoPlanned: (dateLabel) => `План: ${dateLabel}`,
    itemRecordCount: (count) => `${count} зап.`,
    loading: "Считаем…",
    readFailed: "Не удалось прочитать этот период",
  },
  es: {
    modeDay: "Día",
    modeYesterday: "Ayer",
    modeWeek: "Esta semana",
    modeLast7: "Últimos 7 días",
    modeLast30: "Últimos 30 días",
    modeCustom: "Personalizado",
    yesterday: "Ayer",
    thisWeek: "Esta semana",
    last7: "Últimos 7 días",
    last30: "Últimos 30 días",
    customRange: (start, end, days) => `${start} ~ ${end} · ${days} días`,
    rangeModeAria: "Rango del historial",
    summaryActivity: "Tiempo activo",
    summaryTiming: "Tiempo medido",
    summaryNotes: "Notas",
    summaryTodos: "Tareas hechas",
    appsTitle: "Por aplicación",
    itemsTitle: "Por asunto",
    notesTitle: "Notas",
    todosTitle: "Tareas completadas",
    appsEmpty: "Sin actividad en este rango",
    itemsEmpty: "Sin registros de temporizador en este rango",
    notesEmpty: "Sin notas nuevas en este rango",
    todosEmpty: "Sin tareas completadas en este rango",
    dailyTitle: "Actividad diaria",
    dailyHint: "Elige un día para abrir su línea de tiempo",
    timelineTitle: "Línea de tiempo",
    timelineHint: "Una fila por día · los huecos son pausas",
    timelineEmpty: "Sin actividad en este rango",
    timelineLaneAria: (dateLabel, spanLabel, appCount) => `Abrir la línea de ${dateLabel} (${spanLabel}, ${appCount} apps)`,
    openDay: (dateLabel, durationLabel) => `Abrir ${dateLabel} (${durationLabel})`,
    unnamedItem: "Sin nombre",
    noteOnItem: (itemName) => `En «${itemName}»`,
    todoPlanned: (dateLabel) => `Previsto ${dateLabel}`,
    itemRecordCount: (count) => `${count} reg.`,
    loading: "Calculando…",
    readFailed: "No se pudo leer este rango",
  },
};
