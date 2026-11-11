import type { Locale } from "../../shared/i18n/index.ts";

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
export interface DashboardCopy {
  /** 页面级 `sr-only h1`：屏幕阅读器的第一句"这是哪一页"，视觉上没有页头（01 §4.1） */
  pageTitle: string;
  /** 四卡空态（02 §14.4 / M5）：**四句必须不同**。共用一句的话，用户分不清
   *  "今天没有计时"和"今天没有待办"——空态是每张卡自己的陈述，不是页面的。
   *  句式照 `notesEmpty`（§12.3 定稿的陈述句式）：时间 + "还没有" + 东西。 */
  timerEmpty: string;
  itemsEmpty: string;
  appsEmpty: string;
  todosEmpty: string;
  /** 输入框 `aria-label`：**不带省略号**。placeholder 里的"…"会被读屏读出来，
   *  所以 label 与 placeholder 必须是两串（06 T6） */
  todoComposeLabel: string;
  /** 设计模块名是「计时分布」；既有 `dashboard.focusShare` 是「专注分布」，语义不同 */
  timerTitle: string;
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

  itemsTitle: string;
  /** 卡头第一段：今日**全部**事项数（不是列表里那 6 行） */
  itemsCount: (count: number) => string;
  /** 卡头第二段：只有总数 > 6（= 列表被截断）时才出现 */
  itemsMore: (count: number) => string;
  todosTitle: string;
  /** 卡头第一段：待办总数，常驻（与事项卡的「今日 N 项」同口径） */
  todosAll: (count: number) => string;
  /** 卡头第二段：溢出没排下的条数（量出来的，不是写死的） */
  todosRest: (count: number) => string;
  todoCompose: string;
  todoToggle: (title: string) => string;
  /** 已勾选行的 checkbox `aria-label`：必须随 `aria-checked` 换词，
   *  否则读屏对已完成的事还在说"完成"（06 A9 第 5 条） */
  todoUntoggle: (title: string) => string;
  todoDelete: (title: string) => string;
  undoDeleted: (title: string) => string;
  /** 勾选的撤销条文案：勾选是**立即落库**的，撤销 = 反向再调一次，语义不同于删除 */
  undoToggled: (title: string) => string;
  undoAction: string;
  notesTitle: string;
  notesCount: (count: number) => string;
  notesMore: (count: number) => string;
  notesEmpty: string;
  appsTop: (count: number) => string;
  appsFooter: string;
  /* ── [0.12.1] 新增的两张真卡：应用趋势 / 提醒窗口 ── */
  trendTitle: string;
  trendEmpty: string;
  /** 卡头读数：近 7 天合计 */
  trendTotal: (text: string) => string;
  /** 柱的 aria/title：必须同时说出“哪天”与“多久”，只有高度的柱对读屏是空白 */
  trendBar: (day: string, text: string) => string;
  reminderTitle: string;
  reminderEmpty: string;
  reminderCount: (count: number) => string;
  /** 提醒目标类型：`ReminderTarget` 的两个值 */
  reminderKinds: Record<"item" | "todo", string>;
  reminderDue: string;
}

export const DASHBOARD_COPY: Record<Locale, DashboardCopy> = {
  "zh-CN": {
    pageTitle: "今日概览",
    timerEmpty: "今天还没有计时",
    itemsEmpty: "今天还没有事项",
    appsEmpty: "今天还没有用到应用",
    todosEmpty: "今天还没有待办",
    todoComposeLabel: "添加待办",
    timerTitle: "计时分布",
    addCard: "添加卡片",
    resetLayout: "恢复默认布局",
    resizeColumns: "调整两栏宽度",
    resizeWidth: (label) => `调整「${label}」宽度`,
    focusDimensionLabel: "专注窗口维度",
    focusDimensions: { category: "分类", app: "应用", item: "事项" },
    cardLabels: { timer: "专注窗口", items: "事项排行", apps: "应用排行", timeline: "事项菜单", todos: "待办窗口", notes: "便利贴窗口", trend: "应用趋势", reminder: "提醒窗口" },
    itemsTitle: "事项分布",
    itemsCount: (count) => `今日 ${count} 项`,
    itemsMore: (count) => `更多 ${count} 项 ▸`,
    todosTitle: "待办事项",
    todosAll: (count) => `全部 ${count} 项 ▸`,
    todosRest: (count) => `还有 ${count} 项 ▸`,
    todoCompose: "添加待办…",
    todoToggle: (title) => `完成「${title}」`,
    todoUntoggle: (title) => `取消完成「${title}」`,
    todoDelete: (title) => `删除「${title}」`,
    undoDeleted: (title) => `已删除「${title}」`,
    undoToggled: (title) => `已完成「${title}」`,
    undoAction: "撤销",
    notesTitle: "便利贴",
    notesCount: (count) => `${count} 张`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "今天还没有便利贴",
    appsTop: (count) => `前 ${count} 项`,
    appsFooter: "全部分类…",
    trendTitle: "应用趋势",
    trendEmpty: "近 7 天还没有活动记录",
    trendTotal: (text) => `近 7 天 ${text}`,
    trendBar: (day, text) => `${day} ${text}`,
    reminderTitle: "提醒窗口",
    reminderEmpty: "没有待提醒的到点事项",
    reminderCount: (count) => `${count} 条待提醒`,
    reminderKinds: { item: "事项", todo: "待办" },
    reminderDue: "已到点",
  },
  "en-US": {
    pageTitle: "Today overview",
    timerEmpty: "No time tracked today",
    itemsEmpty: "No items today",
    appsEmpty: "No apps used today",
    todosEmpty: "No to-dos today",
    todoComposeLabel: "Add a to-do",
    timerTitle: "Time distribution",
    addCard: "Add card",
    resetLayout: "Reset layout",
    resizeColumns: "Resize columns",
    resizeWidth: (label) => `Resize ${label}`,
    focusDimensionLabel: "Focus dimension",
    focusDimensions: { category: "Category", app: "App", item: "Item" },
    cardLabels: { timer: "Focus", items: "Items", apps: "Applications", timeline: "Timeline", todos: "Todos", notes: "Notes", trend: "App trend", reminder: "Reminders" },
    itemsTitle: "Items",
    itemsCount: (count) => `${count} today`,
    itemsMore: (count) => `${count} more ▸`,
    todosTitle: "To-dos",
    todosAll: (count) => `All ${count} ▸`,
    todosRest: (count) => `${count} more ▸`,
    todoCompose: "Add a to-do…",
    todoToggle: (title) => `Complete “${title}”`,
    todoUntoggle: (title) => `Mark “${title}” as not done`,
    todoDelete: (title) => `Delete “${title}”`,
    undoDeleted: (title) => `Deleted “${title}”`,
    undoToggled: (title) => `Completed “${title}”`,
    undoAction: "Undo",
    notesTitle: "Notes",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "No notes today",
    appsTop: (count) => `Top ${count}`,
    appsFooter: "All categories…",
    trendTitle: "App trend",
    trendEmpty: "No activity in the last 7 days",
    trendTotal: (text) => `Last 7 days ${text}`,
    trendBar: (day, text) => `${day} ${text}`,
    reminderTitle: "Reminders",
    reminderEmpty: "No pending reminders",
    reminderCount: (count) => `${count} pending`,
    reminderKinds: { item: "Item", todo: "To-do" },
    reminderDue: "Due",
  },
  "ru-RU": {
    pageTitle: "Обзор дня",
    timerEmpty: "Сегодня времени нет",
    itemsEmpty: "Сегодня занятий нет",
    appsEmpty: "Сегодня приложения не использовались",
    todosEmpty: "Сегодня задач нет",
    todoComposeLabel: "Добавить задачу",
    timerTitle: "Распределение времени",
    addCard: "Добавить карточку",
    resetLayout: "Сбросить макет",
    resizeColumns: "Ширина колонок",
    resizeWidth: (label) => `Ширина «${label}»`,
    focusDimensionLabel: "Разрез фокуса",
    focusDimensions: { category: "Категория", app: "Приложение", item: "Дело" },
    cardLabels: { timer: "Фокус", items: "События", apps: "Приложения", timeline: "Хронология", todos: "Задачи", notes: "Заметки", trend: "Тренд", reminder: "Напоминания" },
    itemsTitle: "Занятия",
    itemsCount: (count) => `Сегодня ${count}`,
    itemsMore: (count) => `Ещё ${count} ▸`,
    todosTitle: "Задачи",
    todosAll: (count) => `Все ${count} ▸`,
    todosRest: (count) => `Ещё ${count} ▸`,
    todoCompose: "Добавить задачу…",
    todoToggle: (title) => `Завершить «${title}»`,
    todoUntoggle: (title) => `Снять отметку «${title}»`,
    todoDelete: (title) => `Удалить «${title}»`,
    undoDeleted: (title) => `Удалено «${title}»`,
    undoToggled: (title) => `Выполнено «${title}»`,
    undoAction: "Отменить",
    notesTitle: "Заметки",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "Сегодня заметок нет",
    appsTop: (count) => `Топ ${count}`,
    appsFooter: "Все категории…",
    trendTitle: "Тренд приложений",
    trendEmpty: "За последние 7 дней активности нет",
    trendTotal: (text) => `За 7 дней ${text}`,
    trendBar: (day, text) => `${day} ${text}`,
    reminderTitle: "Напоминания",
    reminderEmpty: "Нет ожидающих напоминаний",
    reminderCount: (count) => `Ожидает: ${count}`,
    reminderKinds: { item: "Дело", todo: "Задача" },
    reminderDue: "Просрочено",
  },
  es: {
    pageTitle: "Resumen de hoy",
    timerEmpty: "Hoy no hay registros de tiempo",
    itemsEmpty: "Hoy no hay actividades",
    appsEmpty: "Hoy no se han usado aplicaciones",
    todosEmpty: "Hoy no hay tareas",
    todoComposeLabel: "Añadir tarea",
    timerTitle: "Distribución del tiempo",
    addCard: "Añadir tarjeta",
    resetLayout: "Restablecer diseño",
    resizeColumns: "Ajustar columnas",
    resizeWidth: (label) => `Ancho de ${label}`,
    focusDimensionLabel: "Dimensión de enfoque",
    focusDimensions: { category: "Categoría", app: "Aplicación", item: "Asunto" },
    cardLabels: { timer: "Enfoque", items: "Elementos", apps: "Aplicaciones", timeline: "Cronología", todos: "Pendientes", notes: "Notas", trend: "Tendencia", reminder: "Recordatorios" },
    itemsTitle: "Actividades",
    itemsCount: (count) => `${count} hoy`,
    itemsMore: (count) => `${count} más ▸`,
    todosTitle: "Tareas",
    todosAll: (count) => `Todas ${count} ▸`,
    todosRest: (count) => `${count} más ▸`,
    todoCompose: "Añadir tarea…",
    todoToggle: (title) => `Completar «${title}»`,
    todoUntoggle: (title) => `Desmarcar «${title}»`,
    todoDelete: (title) => `Eliminar «${title}»`,
    undoDeleted: (title) => `Eliminado «${title}»`,
    undoToggled: (title) => `Completado «${title}»`,
    undoAction: "Deshacer",
    notesTitle: "Notas",
    notesCount: (count) => `${count}`,
    notesMore: (count) => `+${count}`,
    notesEmpty: "Hoy no hay notas",
    appsTop: (count) => `Top ${count}`,
    appsFooter: "Todas las categorías…",
    trendTitle: "Tendencia de apps",
    trendEmpty: "Sin actividad en los últimos 7 días",
    trendTotal: (text) => `Últimos 7 días ${text}`,
    trendBar: (day, text) => `${day} ${text}`,
    reminderTitle: "Recordatorios",
    reminderEmpty: "No hay recordatorios pendientes",
    reminderCount: (count) => `${count} pendientes`,
    reminderKinds: { item: "Elemento", todo: "Pendiente" },
    reminderDue: "Vencido",
  },
};
