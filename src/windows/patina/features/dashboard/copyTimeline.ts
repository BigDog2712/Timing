import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 今日时间线卡**「新建 / 编辑 / 管理事项 + 改起止」的文案**（四语言齐备）。
 *
 * 为什么不放 `copy.ts`：那个文件贴着单文件 300 行硬限
 * （`scripts/check-size.mjs` 逐文件棘轮），照 `copyNotes.ts` / `copyAppBinding.ts`
 * 的先例拆出来，再在 `copy.ts` 里用交叉类型
 * `DashboardCopy = DashboardCoreCopy & AppBindingCopy & NoteCopy & TimelineManageCopy`
 * 拼回去 —— 使用侧拿到的仍是**一张表**，调用点不用知道它拆过。
 *
 * 也**不**进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的**位置数组**，
 * 手插一行会让其后全部文案错位（`generated/contract.ts` 还被 size 门禁冻着）。
 *
 * 已有的键照旧复用，不在这里重写：`UI_TEXT.dialog.cancel`（取消）/ `dialog.confirm`
 * （确定）/ `common.close`（关闭）/ `common.loading` / `common.readFailed`。
 */
export interface TimelineManageCopy {
  /** 卡底第一颗「＋ 新建事项」（全角加号，与卡里既有文案同一标点风格） */
  timelineNewItem: string;
  /** 卡底第二颗「编辑事项」（0.13 · 1.6：选事项 → 改名称 + 默认时长，一条 update_item） */
  timelineEditItem: string;
  /** 卡底第三颗「事项管理」（常用 / 近期两组，行内编辑） */
  timelineManageItems: string;
  timelineCreateTitle: string;
  /** 名称输入框的 placeholder（`aria-label` 也复用它，见 `TimelineManage`） */
  timelineCreatePlaceholder: string;
  /** 管理弹层第一组的组标题 */
  timelinePinnedGroup: string;
  /** 管理弹层第二组的组标题 */
  timelineRecentGroup: string;
  /** 默认时长输入框的标签（新建弹层与行内编辑共用） */
  timelineTimerLabel: string;
  /** 默认时长输入框的 placeholder：**留空 = 正计时** */
  timelineTimerPlaceholder: string;
  /** 没有默认时长时行上显示的徽标文案 */
  timelineTimerOff: string;
  /** 有默认时长时的徽标：`25 分钟` / `25 min` */
  timelineMinutesShort: (minutes: number) => string;
  /** 行上的「设为常用」 */
  timelinePinAction: string;
  /** 行上的「取消常用」（= 移出常用，事项本身保留） */
  timelineUnpinAction: string;
  timelineMoveUp: string;
  timelineMoveDown: string;
  /** 行上的「编辑」（就地展开名称 + 默认时长） */
  timelineEditAction: string;
  /** 行内编辑的「保存」 */
  timelineSaveAction: string;
  /** 常用组为空 */
  timelineManageEmpty: string;
  /** 近期组为空 */
  timelineRecentEmpty: string;
  /** 时长输入非法（非数字 / 超出 1–1440） */
  timelineTimerInvalid: string;
  /** 名称校验：空名与超长是**后端也会拒**的（口径见 `services/timelineItemName.ts`） */
  timelineNameEmpty: string;
  timelineNameTooLong: (max: number) => string;
  /** 意图没发出去（没有回执的通道，只能在这里说一句） */
  timelineSaveFailed: string;

  /* ── [0.13 · 1.6] 行三列 + 卡头总计 ── */
  /** 卡头读数：`总计 3h 20m`（口径来自 `useTodayItems.total`，即后端 `accumulated_sec` 之和） */
  timelineTotal: (text: string) => string;
  /** 行的「起止」列：`09:00–10:30` */
  timelineRange: (start: string, end: string) => string;
  /** 进行中那一行的「止」：`14:32 · 进行中`（`{clock}` = 此刻钟点，实时变） */
  timelineNoEnd: (clock: string) => string;

  /* ── [0.13 · T03b] 改起止（`update_record_time` 意图；边界规则见 §3.8） ── */
  /** 行上与弹层标题共用的「改起止」 */
  editRecordTime: string;
  /** 段的开始输入框 `aria-label` */
  recordStartLabel: string;
  /** 段的结束输入框 `aria-label` */
  recordEndLabel: string;
  /** B3：进行中的记录不可改（保存键 disabled + 行上说明，不是空白也不是英文码） */
  onlySavedEditable: string;
  /** 同一起止（时长为 0 的记录不算记录） */
  recordZeroLength: string;
  /** B1：结束早于开始 */
  endBeforeStart: string;
  /** B2：跨零点 → 拒绝 + 指引（不允许生成，而不是生成后提示） */
  crossDayHint: string;
  /** 保存成功（意图已发出；账目由随后的刷新收敛） */
  recordSaved: string;
  /** 意图没发出去（与 `timelineSaveFailed` 同型，但语义属记录编辑，分开一句） */
  recordSaveFailed: string;
}

export const TIMELINE_MANAGE_COPY: Record<Locale, TimelineManageCopy> = {
  "zh-CN": {
    timelineNewItem: "＋ 新建事项",
    timelineEditItem: "编辑事项",
    timelineManageItems: "事项管理",
    timelineCreateTitle: "新建事项",
    timelineCreatePlaceholder: "事项名称",
    timelinePinnedGroup: "常用事项",
    timelineRecentGroup: "近期事项",
    timelineTimerLabel: "默认时长（分钟）",
    timelineTimerPlaceholder: "留空 = 正计时",
    timelineTimerOff: "正计时",
    timelineMinutesShort: (minutes) => `${minutes} 分钟`,
    timelinePinAction: "设为常用",
    timelineUnpinAction: "取消常用",
    timelineMoveUp: "上移",
    timelineMoveDown: "下移",
    timelineEditAction: "编辑",
    timelineSaveAction: "保存",
    timelineManageEmpty: "还没有常用事项",
    timelineRecentEmpty: "还没有近期事项",
    timelineTimerInvalid: "时长需在 1–1440 分钟",
    timelineNameEmpty: "名字不能为空",
    timelineNameTooLong: (max) => `名字最多 ${max} 个字`,
    timelineSaveFailed: "没发出去，请重试",
    timelineTotal: (text) => `总计 ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · 进行中`,
    editRecordTime: "改起止",
    recordStartLabel: "开始时刻",
    recordEndLabel: "结束时刻",
    onlySavedEditable: "进行中的记录要等结束之后才能改",
    recordZeroLength: "开始和结束不能是同一时刻",
    endBeforeStart: "结束时刻要晚于开始",
    crossDayHint: "跨零点的记录请在两天里分别修改",
    recordSaved: "已保存，稍后刷新生效",
    recordSaveFailed: "没发出去，请重试",
  },
  "en-US": {
    timelineNewItem: "＋ New item",
    timelineEditItem: "Edit item",
    timelineManageItems: "Manage items",
    timelineCreateTitle: "New item",
    timelineCreatePlaceholder: "Item name",
    timelinePinnedGroup: "Frequent items",
    timelineRecentGroup: "Recent items",
    timelineTimerLabel: "Default length (minutes)",
    timelineTimerPlaceholder: "Blank = count up",
    timelineTimerOff: "Count up",
    timelineMinutesShort: (minutes) => `${minutes} min`,
    timelinePinAction: "Mark frequent",
    timelineUnpinAction: "Unmark frequent",
    timelineMoveUp: "Move up",
    timelineMoveDown: "Move down",
    timelineEditAction: "Edit",
    timelineSaveAction: "Save",
    timelineManageEmpty: "No frequent items yet",
    timelineRecentEmpty: "No recent items yet",
    timelineTimerInvalid: "Length must be 1–1440 minutes",
    timelineNameEmpty: "Name cannot be empty",
    timelineNameTooLong: (max) => `Name must be at most ${max} characters`,
    timelineSaveFailed: "Not sent, please retry",
    timelineTotal: (text) => `Total ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · running`,
    editRecordTime: "Edit times",
    recordStartLabel: "Start time",
    recordEndLabel: "End time",
    onlySavedEditable: "A running record can only be edited after it ends",
    recordZeroLength: "Start and end cannot be the same instant",
    endBeforeStart: "The end time must be after the start",
    crossDayHint: "A record across midnight must be split into two days",
    recordSaved: "Saved, takes effect after the next refresh",
    recordSaveFailed: "Not sent, please retry",
  },
  "ru-RU": {
    timelineNewItem: "＋ Новое дело",
    timelineEditItem: "Изменить дело",
    timelineManageItems: "Управление делами",
    timelineCreateTitle: "Новое дело",
    timelineCreatePlaceholder: "Название дела",
    timelinePinnedGroup: "Частые дела",
    timelineRecentGroup: "Недавние дела",
    timelineTimerLabel: "Длительность по умолчанию (мин)",
    timelineTimerPlaceholder: "Пусто = прямой отсчёт",
    timelineTimerOff: "Прямой отсчёт",
    timelineMinutesShort: (minutes) => `${minutes} мин`,
    timelinePinAction: "В частые",
    timelineUnpinAction: "Убрать из частых",
    timelineMoveUp: "Выше",
    timelineMoveDown: "Ниже",
    timelineEditAction: "Изменить",
    timelineSaveAction: "Сохранить",
    timelineManageEmpty: "Частых дел пока нет",
    timelineRecentEmpty: "Недавних дел пока нет",
    timelineTimerInvalid: "Длительность от 1 до 1440 минут",
    timelineNameEmpty: "Название не может быть пустым",
    timelineNameTooLong: (max) => `Не более ${max} символов`,
    timelineSaveFailed: "Не отправлено, повторите",
    timelineTotal: (text) => `Всего ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · идёт`,
    editRecordTime: "Изменить время",
    recordStartLabel: "Время начала",
    recordEndLabel: "Время конца",
    onlySavedEditable: "Идущую запись можно изменить только после её завершения",
    recordZeroLength: "Начало и конец не могут быть одним моментом",
    endBeforeStart: "Конец должен быть позже начала",
    crossDayHint: "Запись через полночь нужно разделить на два дня",
    recordSaved: "Сохранено, вступит в силу после обновления",
    recordSaveFailed: "Не отправлено, повторите",
  },
  es: {
    timelineNewItem: "＋ Nuevo asunto",
    timelineEditItem: "Editar asunto",
    timelineManageItems: "Gestionar asuntos",
    timelineCreateTitle: "Nuevo asunto",
    timelineCreatePlaceholder: "Nombre del asunto",
    timelinePinnedGroup: "Asuntos frecuentes",
    timelineRecentGroup: "Asuntos recientes",
    timelineTimerLabel: "Duración por defecto (min)",
    timelineTimerPlaceholder: "Vacío = cronómetro",
    timelineTimerOff: "Cronómetro",
    timelineMinutesShort: (minutes) => `${minutes} min`,
    timelinePinAction: "Marcar frecuente",
    timelineUnpinAction: "Quitar de frecuentes",
    timelineMoveUp: "Subir",
    timelineMoveDown: "Bajar",
    timelineEditAction: "Editar",
    timelineSaveAction: "Guardar",
    timelineManageEmpty: "Aún no hay asuntos frecuentes",
    timelineRecentEmpty: "Aún no hay asuntos recientes",
    timelineTimerInvalid: "La duración debe ser 1–1440 minutos",
    timelineNameEmpty: "El nombre no puede estar vacío",
    timelineNameTooLong: (max) => `Máximo ${max} caracteres`,
    timelineSaveFailed: "No se envió, inténtalo de nuevo",
    timelineTotal: (text) => `Total ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · en curso`,
    editRecordTime: "Editar horas",
    recordStartLabel: "Hora de inicio",
    recordEndLabel: "Hora de fin",
    onlySavedEditable: "Un registro en curso solo puede editarse cuando termine",
    recordZeroLength: "El inicio y el fin no pueden ser el mismo instante",
    endBeforeStart: "La hora de fin debe ser posterior al inicio",
    crossDayHint: "Un registro que cruza la medianoche debe repartirse en dos días",
    recordSaved: "Guardado, surte efecto tras la próxima actualización",
    recordSaveFailed: "No se envió, inténtalo de nuevo",
  },
};
