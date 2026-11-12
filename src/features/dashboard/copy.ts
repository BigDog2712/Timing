import type { Locale } from "../../shared/i18n/index.ts";
import { APP_BINDING_COPY, type AppBindingCopy } from "./copyAppBinding.ts";
import { NOTE_COPY, type NoteCopy } from "./copyNotes.ts";
import { TIMELINE_MANAGE_COPY, type TimelineManageCopy } from "./copyTimeline.ts";
import { TODO_COPY, type TodoCopy } from "./copyTodos.ts";

/**
 * 今日五模块 + 便利贴条的**新文案表**（四语言齐备）。
 *
 * 为什么不进 `src/shared/i18n/**`（02 §5.3 A12）：那四个 locale 文件是按索引对齐的
 * **位置数组**，手插一行会让其后全部文案错位；`generated/contract.ts` 还在
 * `scripts/size-allowlist.json` 里冻结着。所以新文案一律组件侧自有，
 * 且**必须是 `Record<Locale, …>` 四键齐全** —— 不许写 `locale.startsWith("zh") ? zh : en`
 * 那种两档写法（`TimingCapsule.tsx:48` 就是那个既有缺陷，ru/es 会静默降级成英文）。
 *
 * 已有的键照旧走 `useLocaleText()`（`dashboard.emptyState` / `dashboard.topApps` /
 * `dashboard.comparedWithYesterday` / `common.*`），本表只放**仓里还没有的**标题与动词。
 */
export interface DashboardCoreCopy {
  /** 页面级 `sr-only h1`：屏幕阅读器的第一句"这是哪一页"，视觉上没有页头（01 §4.1） */
  pageTitle: string;
  /** 四卡空态（02 §14.4 / M5）：**四句必须不同**。共用一句的话，用户分不清
   *  "今天没有计时"和"今天没有待办"——空态是每张卡自己的陈述，不是页面的。
   *  句式照 `notesEmpty`（§12.3 定稿的陈述句式）：时间 + "还没有" + 东西。
   *  待办卡那句（`todosEmpty`）随整块待办文案搬去了 `copyTodos.ts`。 */
  timerEmpty: string;
  appsEmpty: string;
  /** 设计模块名是「计时分布」；既有 `dashboard.focusShare` 是「专注分布」，语义不同 */
  timerTitle: string;
  /** 卡头读数：exe 的 `meta(Timer)` 就是「今日 14m」（`widgets/mod.rs:141`） */
  timerToday: (text: string) => string;
  /** 环心第二行（`focus.rs:120` 的「今日合计」，10px） */
  timerDonutCap: string;
  addCard: string;
  /** 工具条第二颗键：把布局恢复成出厂（`useDashboardLayout().reset` 一直没有 UI 入口，
   *  用户把卡移除乱了就只能删 localStorage —— 这条是补那个缺口，不是新功能。 */
  resetLayout: string;
  /** 列间分隔条的 aria-label（拖它改左右比例） */
  resizeColumns: string;
  /** [单独宽度] 卡右边缘拖拽手柄的 aria-label（`{label}` = 卡名，见 `cardLabels`） */
  resizeWidth: (label: string) => string;
  cardLabels: Record<string, string>;
  focusDimensionLabel: string;
  focusDimensions: Record<"category" | "app" | "item", string>;

  /** 时间线卡头第一颗按钮：发的是「打开事项菜单」意图，文案不能跟着卡名走 */
  itemsMenu: string;
  /** 同卡第二颗：打开「常用事项」（exe 的事项卡里那一列「常用」） */
  commonItems: string;
  /** 应用卡头读数：exe 的 `meta(Apps)` 只有总时长，没有「前 N 项」 */
  appsMeta: (text: string) => string;
  /** 应用卡底注：exe 「共 5 个应用 · 合计 14m」（`apps.rs:86`） */
  appsSummary: (count: number, text: string) => string;
  /** 热力图卡头读数：exe 「近 4 周」（`widgets/mod.rs:159`） */
  heatmapMeta: (weeks: number) => string;
  notesTitle: string;
  notesCount: (count: number) => string;
  notesMore: (count: number) => string;
  notesEmpty: string;
  appsTop: (count: number) => string;
  appsFooter: string;
  /* ── [0.12.1] 新增的两张真卡：应用趋势 / 提醒窗口 ── */
  /** [今日分时] 卡标题「今日活动趋势」——主人要的口径是只看今天 */
  trendTitle: string;
  trendEmpty: string;
  /** 图表顶部左读数：今日总时长 */
  trendTotal: (text: string) => string;
  /** 柱的 aria/title：必须同时说出「几点到几点」与「多久」，只有高度的柱对读屏是空白 */
  trendBar: (slot: string, text: string) => string;
  /** 最后一根柱（＝当前这一小时）的轴文字：「现在」 */
  trendToday: string;
  /** 图表顶部右读数：峰值时刻 + 该小时时长（`14:00 · 1h 20m`） */
  trendPeak: (text: string) => string;
  /** 轴文字里的小时（只出现三处：首 / 中）：zh「8点」、其余「8:00」 */
  trendHourTick: (hour: number) => string;
}

/** 整页文案 = 本表 + 应用行/绑定弹层的那批（`copyAppBinding.ts`）+ 便利贴删除那两颗
 *  （`copyNotes.ts`）+ 时间线卡「新建/管理事项」（`copyTimeline.ts`）+ 待办卡整块
 *  （`copyTodos.ts`，含本轮新建弹层）。
 *  拆文件是为了守住单文件 300 行上限；口径完全相同、"四键齐全"这条也一样。 */
export type DashboardCopy = DashboardCoreCopy
  & AppBindingCopy
  & NoteCopy
  & TimelineManageCopy
  & TodoCopy;

export const DASHBOARD_COPY: Record<Locale, DashboardCopy> = {
  "zh-CN": {
    ...APP_BINDING_COPY["zh-CN"],
    ...NOTE_COPY["zh-CN"],
    ...TIMELINE_MANAGE_COPY["zh-CN"],
    ...TODO_COPY["zh-CN"],
    pageTitle: "今日概览",
    timerEmpty: "今天还没有计时",
    appsEmpty: "今天还没有用到应用",
    timerTitle: "计时分布",
    timerToday: (text) => `今日 ${text}`,
    timerDonutCap: "今日合计",
    addCard: "添加卡片",
    resetLayout: "恢复默认布局",
    resizeColumns: "调整两栏宽度",
    resizeWidth: (label) => `调整「${label}」宽度`,
    focusDimensionLabel: "专注窗口维度",
    focusDimensions: { category: "分类", app: "应用", item: "事项" },
    cardLabels: { timer: "计时分布", apps: "应用排行", timeline: "今日时间线", todos: "待办事项", notes: "便利贴", trend: "今日活动趋势", heatmap: "活动热力图" },
    itemsMenu: "事项菜单",
    commonItems: "常用",
    appsMeta: (text) => text,
    appsSummary: (count, text) => `共 ${count} 个应用 · 合计 ${text}`,
    heatmapMeta: (weeks) => `近 ${weeks} 周`,
    notesTitle: "便利贴",
    notesCount: (count) => `${count} 张`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "今天还没有便利贴",
    appsTop: (count) => `前 ${count} 项`,
    appsFooter: "全部分类…",
    trendTitle: "今日活动趋势",
    trendEmpty: "今天还没有活动记录",
    trendTotal: (text) => `今日 ${text}`,
    trendBar: (slot, text) => `${slot} · ${text}`,
    trendToday: "现在",
    trendPeak: (text) => `峰值 ${text}`,
    trendHourTick: (hour) => `${hour}点`,
  },
  "en-US": {
    ...APP_BINDING_COPY["en-US"],
    ...NOTE_COPY["en-US"],
    ...TIMELINE_MANAGE_COPY["en-US"],
    ...TODO_COPY["en-US"],
    pageTitle: "Today overview",
    timerEmpty: "No time tracked today",
    appsEmpty: "No apps used today",
    timerTitle: "Time distribution",
    timerToday: (text) => `Today ${text}`,
    timerDonutCap: "Total today",
    addCard: "Add card",
    resetLayout: "Reset layout",
    resizeColumns: "Resize columns",
    resizeWidth: (label) => `Resize ${label}`,
    focusDimensionLabel: "Focus dimension",
    focusDimensions: { category: "Category", app: "App", item: "Item" },
    cardLabels: { timer: "Time split", apps: "Applications", timeline: "Timeline", todos: "To-dos", notes: "Notes", trend: "Today's activity", heatmap: "Activity heatmap" },
    itemsMenu: "Items menu",
    commonItems: "Frequent",
    appsMeta: (text) => text,
    appsSummary: (count, text) => `${count} apps · ${text} total`,
    heatmapMeta: (weeks) => `Last ${weeks} weeks`,
    notesTitle: "Notes",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "No notes today",
    appsTop: (count) => `Top ${count}`,
    appsFooter: "All categories…",
    trendTitle: "Today's activity",
    trendEmpty: "No activity today",
    trendTotal: (text) => `Today ${text}`,
    trendBar: (slot, text) => `${slot} · ${text}`,
    trendToday: "Now",
    trendPeak: (text) => `Peak ${text}`,
    trendHourTick: (hour) => `${hour}:00`,
  },
  "ru-RU": {
    ...APP_BINDING_COPY["ru-RU"],
    ...NOTE_COPY["ru-RU"],
    ...TIMELINE_MANAGE_COPY["ru-RU"],
    ...TODO_COPY["ru-RU"],
    pageTitle: "Обзор дня",
    timerEmpty: "Сегодня времени нет",
    appsEmpty: "Сегодня приложения не использовались",
    timerTitle: "Распределение времени",
    timerToday: (text) => `Сегодня ${text}`,
    timerDonutCap: "Итого за день",
    addCard: "Добавить карточку",
    resetLayout: "Сбросить макет",
    resizeColumns: "Ширина колонок",
    resizeWidth: (label) => `Ширина «${label}»`,
    focusDimensionLabel: "Разрез фокуса",
    focusDimensions: { category: "Категория", app: "Приложение", item: "Дело" },
    cardLabels: { timer: "Распределение времени", apps: "Приложения", timeline: "Хронология", todos: "Задачи", notes: "Заметки", trend: "Активность сегодня", heatmap: "Тепловая карта" },
    itemsMenu: "Меню дел",
    commonItems: "Частые",
    appsMeta: (text) => text,
    appsSummary: (count, text) => `${count} прил. · ${text}`,
    heatmapMeta: (weeks) => `Последние ${weeks} нед.`,
    notesTitle: "Заметки",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "Сегодня заметок нет",
    appsTop: (count) => `Топ ${count}`,
    appsFooter: "Все категории…",
    trendTitle: "Активность сегодня",
    trendEmpty: "Сегодня активности нет",
    trendTotal: (text) => `Сегодня ${text}`,
    trendBar: (slot, text) => `${slot} · ${text}`,
    trendToday: "Сейчас",
    trendPeak: (text) => `Пик ${text}`,
    trendHourTick: (hour) => `${hour}:00`,
  },
  es: {
    ...APP_BINDING_COPY.es,
    ...NOTE_COPY.es,
    ...TIMELINE_MANAGE_COPY.es,
    ...TODO_COPY.es,
    pageTitle: "Resumen de hoy",
    timerEmpty: "Hoy no hay registros de tiempo",
    appsEmpty: "Hoy no se han usado aplicaciones",
    timerTitle: "Distribución del tiempo",
    timerToday: (text) => `Hoy ${text}`,
    timerDonutCap: "Total de hoy",
    addCard: "Añadir tarjeta",
    resetLayout: "Restablecer diseño",
    resizeColumns: "Ajustar columnas",
    resizeWidth: (label) => `Ancho de ${label}`,
    focusDimensionLabel: "Dimensión de enfoque",
    focusDimensions: { category: "Categoría", app: "Aplicación", item: "Asunto" },
    cardLabels: { timer: "Reparto del tiempo", apps: "Aplicaciones", timeline: "Cronología", todos: "Pendientes", notes: "Notas", trend: "Actividad de hoy", heatmap: "Mapa de calor" },
    itemsMenu: "Menú de asuntos",
    commonItems: "Frecuentes",
    appsMeta: (text) => text,
    appsSummary: (count, text) => `${count} apps · ${text}`,
    heatmapMeta: (weeks) => `Últimas ${weeks} sem.`,
    notesTitle: "Notas",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "Hoy no hay notas",
    appsTop: (count) => `Top ${count}`,
    appsFooter: "Todas las categorías…",
    trendTitle: "Actividad de hoy",
    trendEmpty: "Hoy no hay actividad",
    trendTotal: (text) => `Hoy ${text}`,
    trendBar: (slot, text) => `${slot} · ${text}`,
    trendToday: "Ahora",
    trendPeak: (text) => `Pico ${text}`,
    trendHourTick: (hour) => `${hour}:00`,
  },
};
