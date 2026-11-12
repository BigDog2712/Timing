import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 「待办事项」卡的**全部文案**（四语言齐备）—— [本轮] 从 `copy.ts` 整块搬出来。
 *
 * 为什么不放 `copy.ts`：那个文件抽走这一块之前是 299 行，贴着单文件 300 行硬限
 * （`scripts/check-size.mjs` 逐文件棘轮），而本轮还要再加十来条「新建待办弹层」的键。
 * 照 `copyNotes.ts` / `copyTimeline.ts` / `copyAppBinding.ts` 的先例拆出来，再在
 * `copy.ts` 里用交叉类型 `DashboardCopy = … & TodoCopy` 拼回去 —— 使用侧拿到的仍是
 * **一张表**，调用点不用知道它拆过。
 *
 * 也**不**进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的**位置数组**，
 * 手插一行会让其后全部文案错位（`generated/contract.ts` 还被 size 门禁冻着）。
 *
 * 已有的键照旧复用，不在这里重写：`UI_TEXT.dialog.cancel`（取消）/ `dialog.confirm`
 * （确定）/ `common.readFailed` / `common.refreshFailed` / `common.retry`；
 * 名称校验的两句复用 `copyTimeline.ts` 的 `timelineNameEmpty` / `timelineNameTooLong`
 * （同一个后端口径：1-200 字，空名与超长后端也会拒），不为待办再造一对同义句。
 */
export interface TodoCopy {
  todosTitle: string;
  /** 空态（§14.4）：与其余三卡**必须不同句**，否则用户分不清"今天没有计时"和"今天没有待办" */
  todosEmpty: string;
  /** 名称输入框的 placeholder（也复用为「添加待办…」） */
  todoCompose: string;
  /** 卡头读数：exe 的 `meta(Todos)` = 「N 条待办」（`widgets/mod.rs:156`） */
  todosMeta: (count: number) => string;
  /** 卡头第一段：待办总数 */
  todosAll: (count: number) => string;
  /** 卡头第二段：溢出没排下的条数（量出来的，不是写死的） */
  todosRest: (count: number) => string;
  todoToggle: (title: string) => string;
  /** 已勾选行的 checkbox `aria-label`：必须随 `aria-checked` 换词（06 A9 第 5 条） */
  todoUntoggle: (title: string) => string;
  todoDelete: (title: string) => string;
  undoDeleted: (title: string) => string;
  /** 勾选的撤销条文案：勾选是**立即落库**的，撤销 = 反向再调一次，语义不同于删除 */
  undoToggled: (title: string) => string;
  undoAction: string;

  /* ── [本轮] 新建待办弹层（与「新建事项」完全对齐的入口） ── */
  /** 卡底那颗入口（全角加号，与 `timelineNewItem` 同一标点风格） */
  todoNewTodo: string;
  /** 弹层标题 */
  todoCreateTitle: string;
  /** 名称输入框的视觉标签（同时是 `aria-label`） */
  todoNameLabel: string;
  /** 计划时间字段的标签 */
  todoTimeLabel: string;
  /** 时间右侧的清除键（清空 = 不排期） */
  todoTimeClear: string;
  /** 「提醒我」勾选行的标签 */
  todoRemindLabel: string;
  /** 勾上之后的说明：**按宿主真实行为写**（T-15 轻提醒 + T-5 询问），
   *  写成"到点提醒"就是撒谎 —— 宿主根本没有"到点那一下" */
  todoRemindHint: string;
  /** 时间为空时勾选行的解释（不是灰着不解释） */
  todoRemindNeedsTime: string;
  /** 勾了提醒但时间已过：宿主 `nudge_due` 有过期 grace 窗口，不会补弹 → 必须提交前拦 */
  todoTimePast: string;
  /** 时间字符串解析失败 */
  todoTimeInvalid: string;
  /** 落库失败（`create` 返回 false）：弹层不关、草稿不清 */
  todoCreateFailed: string;
  /** 行上铃铛的 `aria-label`：`{clock}` = `HH:mm` */
  todoRemindAt: (clock: string) => string;
}

export const TODO_COPY: Record<Locale, TodoCopy> = {
  "zh-CN": {
    todosTitle: "待办事项",
    todosEmpty: "今天还没有待办",
    todoCompose: "添加待办…",
    todosMeta: (count) => `${count} 条待办`,
    todosAll: (count) => `全部 ${count} 项 ▸`,
    todosRest: (count) => `还有 ${count} 项 ▸`,
    todoToggle: (title) => `完成「${title}」`,
    todoUntoggle: (title) => `取消完成「${title}」`,
    todoDelete: (title) => `删除「${title}」`,
    undoDeleted: (title) => `已删除「${title}」`,
    undoToggled: (title) => `已完成「${title}」`,
    undoAction: "撤销",
    todoNewTodo: "＋ 新建待办",
    todoCreateTitle: "新建待办",
    todoNameLabel: "待办名称",
    todoTimeLabel: "计划时间",
    todoTimeClear: "清除时间",
    todoRemindLabel: "提醒我",
    todoRemindHint: "提前 15 分钟轻提醒，提前 5 分钟问要不要接着开始",
    todoRemindNeedsTime: "先填时间才能设提醒",
    todoTimePast: "提醒时间要晚于现在",
    todoTimeInvalid: "时间格式不对",
    todoCreateFailed: "没能创建这条待办，请重试",
    todoRemindAt: (clock) => `已设提醒 ${clock}`,
  },
  "en-US": {
    todosTitle: "To-dos",
    todosEmpty: "No to-dos today",
    todoCompose: "Add a to-do…",
    todosMeta: (count) => `${count} to-dos`,
    todosAll: (count) => `All ${count} ▸`,
    todosRest: (count) => `${count} more ▸`,
    todoToggle: (title) => `Complete “${title}”`,
    todoUntoggle: (title) => `Mark “${title}” as not done`,
    todoDelete: (title) => `Delete “${title}”`,
    undoDeleted: (title) => `Deleted “${title}”`,
    undoToggled: (title) => `Completed “${title}”`,
    undoAction: "Undo",
    todoNewTodo: "＋ New to-do",
    todoCreateTitle: "New to-do",
    todoNameLabel: "To-do name",
    todoTimeLabel: "Planned time",
    todoTimeClear: "Clear time",
    todoRemindLabel: "Remind me",
    todoRemindHint: "A light nudge 15 min before, and a question 5 min before about starting next",
    todoRemindNeedsTime: "Set a time first to turn on reminders",
    todoTimePast: "The reminder time must be in the future",
    todoTimeInvalid: "Invalid time format",
    todoCreateFailed: "Could not create this to-do, please retry",
    todoRemindAt: (clock) => `Reminder set for ${clock}`,
  },
  "ru-RU": {
    todosTitle: "Задачи",
    todosEmpty: "Сегодня задач нет",
    todoCompose: "Добавить задачу…",
    todosMeta: (count) => `${count} задач`,
    todosAll: (count) => `Все ${count} ▸`,
    todosRest: (count) => `Ещё ${count} ▸`,
    todoToggle: (title) => `Завершить «${title}»`,
    todoUntoggle: (title) => `Снять отметку «${title}»`,
    todoDelete: (title) => `Удалить «${title}»`,
    undoDeleted: (title) => `Удалено «${title}»`,
    undoToggled: (title) => `Выполнено «${title}»`,
    undoAction: "Отменить",
    todoNewTodo: "＋ Новая задача",
    todoCreateTitle: "Новая задача",
    todoNameLabel: "Название задачи",
    todoTimeLabel: "Плановое время",
    todoTimeClear: "Очистить время",
    todoRemindLabel: "Напомнить",
    todoRemindHint: "За 15 минут — мягкое напоминание, за 5 минут — вопрос, начинать ли следом",
    todoRemindNeedsTime: "Сначала укажите время",
    todoTimePast: "Время напоминания должно быть в будущем",
    todoTimeInvalid: "Неверный формат времени",
    todoCreateFailed: "Не удалось создать задачу, повторите",
    todoRemindAt: (clock) => `Напоминание в ${clock}`,
  },
  es: {
    todosTitle: "Tareas",
    todosEmpty: "Hoy no hay tareas",
    todoCompose: "Añadir tarea…",
    todosMeta: (count) => `${count} pendientes`,
    todosAll: (count) => `Todas ${count} ▸`,
    todosRest: (count) => `${count} más ▸`,
    todoToggle: (title) => `Completar «${title}»`,
    todoUntoggle: (title) => `Desmarcar «${title}»`,
    todoDelete: (title) => `Eliminar «${title}»`,
    undoDeleted: (title) => `Eliminado «${title}»`,
    undoToggled: (title) => `Completado «${title}»`,
    undoAction: "Deshacer",
    todoNewTodo: "＋ Nueva tarea",
    todoCreateTitle: "Nueva tarea",
    todoNameLabel: "Nombre de la tarea",
    todoTimeLabel: "Hora prevista",
    todoTimeClear: "Borrar la hora",
    todoRemindLabel: "Recordármelo",
    todoRemindHint: "Un aviso suave 15 min antes y una pregunta 5 min antes sobre empezar después",
    todoRemindNeedsTime: "Primero indica una hora",
    todoTimePast: "La hora del recordatorio debe ser futura",
    todoTimeInvalid: "Formato de hora incorrecto",
    todoCreateFailed: "No se pudo crear la tarea, inténtalo de nuevo",
    todoRemindAt: (clock) => `Recordatorio a las ${clock}`,
  },
};
