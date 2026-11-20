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
  /** 卡底第一颗「新建事项」（[本轮] 去掉前缀的「＋」：入口靠位置与颜色区分，不靠加号） */
  timelineNewItem: string;
  /** 卡底第二颗「编辑事项」（0.13 · 1.6：选事项 → 改名称 + 默认时长，一条 update_item） */
  timelineEditItem: string;
  /** 卡底第三颗「事项管理」（常用 / 近期两组，行内编辑） */
  timelineManageItems: string;
  timelineCreateTitle: string;
  /** 名称输入框的 placeholder（`aria-label` 也复用它，见 `TimelineManage`） */
  timelineCreatePlaceholder: string;
  /** [0.13] 事项分类下拉的标签（下拉的 `aria-label`，新建弹层与行内共用） */
  timelineCategoryLabel: string;
  /** 分类下拉里那一项「不归任何分类」（写回的是 `null`，不是空串） */
  timelineCategoryNone: string;
  /** 打开分类管理弹层的入口（新建弹层里那颗小键） */
  timelineManageCategories: string;
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
  /** 「编辑事项」的候选为空：今天时间线上还没有事项（候选 = 今日计时过的事项） */
  timelineEditEmpty: string;
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
  /** 行上的展开键：`展开 3 条子记录` / `收起子记录`（`count` = 子记录 + 空档的总条数） */
  timelineChildrenToggle: (count: number) => string;
  timelineChildrenCollapse: string;
  /** 块内没采集到应用的那一段：`未采集 11:00–11:30`（不是 0 秒，见设计文档 §6） */
  timelineUnmeasured: (range: string) => string;

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

  /* ── [0.12.6] 时间线卡（待办 + 时间线）与事项管理卡 ── */
  /** 事项管理卡的区标题（卡头已写「事项管理」，区里说清这列表装的是哪两段） */
  itemsManageTitle: string;
  /** 时间线卡的**下区**标题（上区是待办，见 `copyTodos.ts` 的 `todosTitle`） */
  itemsTitle: string;
  /** 事项管理卡的第一组（置顶在前） */
  itemsPinnedGroup: string;
  /** 事项管理卡的第二组：最近用过、但没置顶的事项 */
  itemsRecentGroup: string;
  /** 事项管理卡的一句空态（两组都空） */
  itemsEmpty: string;
  /** 时间线卡下区的一句空态（今天一条计时记录都没有） */
  itemsTimelineEmpty: string;
  /** 时间线卡两区之间那条浅横线的 `aria-label`（`role="separator"`，读屏要念得出来） */
  itemsDividerLabel: string;
  /** 事项管理卡动作组的「新增」（「编辑」「事项管理」复用 `timelineEditItem` / `timelineManageItems`） */
  itemsNewAction: string;
  /** 事项管理卡动作组的 AI 一键分类 */
  itemsAiTag: string;
  /** 事项管理卡行上的绑定标记（只表示"这个事项绑了应用"，不列具体是哪个） */
  itemsBoundMark: string;
  /** 行点击起停的 `aria-label`（行本体是一个按钮） */
  itemsStartTimer: (name: string) => string;

  /* ── [0.12.6 · T4] 行点击起停 + AI 一键分类 ── */
  /** 正在计这一条时的 `aria-label`（同一个按钮，方向反过来了） */
  itemsStopTimer: (name: string) => string;
  /** 宿主**确认之后**才出的提示（发信侧不承诺结果，见 `useItemTimerToggle`） */
  itemsTimerStarted: (name: string) => string;
  itemsTimerStopped: (name: string) => string;
  /** 连"我想干什么"都没发出去（桥断了，不是宿主的错） */
  itemsTimerSendFailed: string;
  /** AI 按键上的进行态：`正在分类…` */
  itemsAiTagBusy: string;
  /** 没有未打标事项时按键的置灰理由（同时也是点击后的提示） */
  itemsAiTagNothing: string;
  /** 未配置 AI 时按键的置灰理由 */
  itemsAiTagNoConfig: string;
  /** 候选表为空：AI 没有可以挑的标签路径 */
  itemsAiTagNoCandidates: string;
  /** 模型这批没给出可用的建议（不是"没事项"，别混用一句） */
  itemsAiTagNoSuggestion: string;
  /** 预览层标题 / 说明（说明必须写明"没勾的不写"） */
  itemsAiTagPreviewTitle: string;
  itemsAiTagPreviewDesc: string;
  /** 预览层确认键：`应用（3）`（数字 = 会真正写出去的条数） */
  itemsAiTagApply: (count: number) => string;
  itemsAiTagNothingSelected: string;
  /** 行上那颗勾选框的 `aria-label`（反向表述：勾掉 = 不写这一条） */
  itemsAiTagSkipRow: string;
  /** 落库结果：`已写入 5 条，跳过 1 条`（跳过 = 意图没发出去） */
  itemsAiTagResult: (written: number, skipped: number) => string;
  /** 预览层里"AI 也没想法"的那些：不占列表，只报条数 */
  itemsAiTagSkippedRows: (count: number) => string;
  /** 整体撤销（只保留最近一次，撤销后按钮消失） */
  itemsAiTagUndo: string;
  itemsAiTagUndone: (count: number) => string;
}

export const TIMELINE_MANAGE_COPY: Record<Locale, TimelineManageCopy> = {
  "zh-CN": {
    timelineNewItem: "新建事项",
    timelineEditItem: "编辑事项",
    timelineManageItems: "事项管理",
    timelineCreateTitle: "新建事项",
    timelineCreatePlaceholder: "事项名称",
    timelineCategoryLabel: "分类",
    timelineCategoryNone: "未分类",
    timelineManageCategories: "管理分类",
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
    timelineEditEmpty: "今天的时间线上还没有事项，先用卡底的「新建事项」记一笔。",
    timelineRecentEmpty: "还没有近期事项",
    timelineTimerInvalid: "时长需在 1–1440 分钟",
    timelineNameEmpty: "名字不能为空",
    timelineNameTooLong: (max) => `名字最多 ${max} 个字`,
    timelineSaveFailed: "没发出去，请重试",
    timelineTotal: (text) => `总计 ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · 进行中`,
    timelineChildrenToggle: (count) => `展开 ${count} 条子记录`,
    timelineChildrenCollapse: "收起子记录",
    timelineUnmeasured: (range) => `未采集 ${range}`,
    editRecordTime: "改起止",
    recordStartLabel: "开始时刻",
    recordEndLabel: "结束时刻",
    onlySavedEditable: "进行中的记录要等结束之后才能改",
    recordZeroLength: "开始和结束不能是同一时刻",
    endBeforeStart: "结束时刻要晚于开始",
    crossDayHint: "跨零点的记录请在两天里分别修改",
    recordSaved: "已保存，稍后刷新生效",
    recordSaveFailed: "没发出去，请重试",
    itemsManageTitle: "常用与历史",
    itemsTitle: "今日时间线",
    itemsPinnedGroup: "常用事项",
    itemsRecentGroup: "历史事项",
    itemsEmpty: "还没有事项 · 点「新增」建一个",
    itemsTimelineEmpty: "今天还没有计时记录",
    itemsDividerLabel: "待办与今日时间线之间的分隔",
    itemsNewAction: "新增",
    itemsAiTag: "一键 AI 分类",
    itemsBoundMark: "已绑定应用",
    itemsStartTimer: (name) => `开始计时：${name}`,
    itemsStopTimer: (name) => `结束计时：${name}`,
    itemsTimerStarted: (name) => `已开始计时：${name}`,
    itemsTimerStopped: (name) => `已结束计时：${name}`,
    itemsTimerSendFailed: "没通知到计时器，再点一次",
    itemsAiTagBusy: "正在分类…",
    itemsAiTagNothing: "没有需要分类的事项",
    itemsAiTagNoConfig: "未配置 AI，去设置",
    itemsAiTagNoCandidates: "还没有任何标签 —— 先建一个标签，AI 才有地方挂",
    itemsAiTagNoSuggestion: "AI 这次没给出可用的标签建议，稍后再试",
    itemsAiTagPreviewTitle: "AI 建议标签",
    itemsAiTagPreviewDesc: "只列还没打标的事项。勾掉的不写入，取消则一条都不写。",
    itemsAiTagApply: (count) => `应用（${count}）`,
    itemsAiTagNothingSelected: "没有勾选任何事项",
    itemsAiTagSkipRow: "不写入这一条",
    itemsAiTagResult: (written, skipped) =>
      skipped > 0 ? `已写入 ${written} 条，跳过 ${skipped} 条` : `已写入 ${written} 条`,
    itemsAiTagSkippedRows: (count) => `另有 ${count} 条 AI 没给出建议，保持不动`,
    itemsAiTagUndo: "撤销本次分类",
    itemsAiTagUndone: (count) => `已撤销 ${count} 条分类`,
  },
  "en-US": {
    timelineNewItem: "New item",
    timelineEditItem: "Edit item",
    timelineManageItems: "Manage items",
    timelineCreateTitle: "New item",
    timelineCreatePlaceholder: "Item name",
    timelineCategoryLabel: "Category",
    timelineCategoryNone: "Uncategorized",
    timelineManageCategories: "Manage categories",
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
    timelineEditEmpty: "Nothing on today’s timeline yet — add one with “New item” first.",
    timelineRecentEmpty: "No recent items yet",
    timelineTimerInvalid: "Length must be 1–1440 minutes",
    timelineNameEmpty: "Name cannot be empty",
    timelineNameTooLong: (max) => `Name must be at most ${max} characters`,
    timelineSaveFailed: "Not sent, please retry",
    timelineTotal: (text) => `Total ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · running`,
    timelineChildrenToggle: (count) => `Show ${count} child records`,
    timelineChildrenCollapse: "Hide child records",
    timelineUnmeasured: (range) => `Not captured ${range}`,
    editRecordTime: "Edit times",
    recordStartLabel: "Start time",
    recordEndLabel: "End time",
    onlySavedEditable: "A running record can only be edited after it ends",
    recordZeroLength: "Start and end cannot be the same instant",
    endBeforeStart: "The end time must be after the start",
    crossDayHint: "A record across midnight must be split into two days",
    recordSaved: "Saved, takes effect after the next refresh",
    recordSaveFailed: "Not sent, please retry",
    itemsManageTitle: "Frequent & past",
    itemsTitle: "Today’s timeline",
    itemsPinnedGroup: "Frequent items",
    itemsRecentGroup: "Past items",
    itemsEmpty: "No items yet · use “New” to create one",
    itemsTimelineEmpty: "No tracked time today",
    itemsDividerLabel: "Divider between to-dos and today’s timeline",
    itemsNewAction: "New",
    itemsAiTag: "One-click AI tagging",
    itemsBoundMark: "App bound",
    itemsStartTimer: (name) => `Start timer: ${name}`,
    itemsStopTimer: (name) => `Stop timer: ${name}`,
    itemsTimerStarted: (name) => `Timer started: ${name}`,
    itemsTimerStopped: (name) => `Timer stopped: ${name}`,
    itemsTimerSendFailed: "Couldn’t reach the timer, tap again",
    itemsAiTagBusy: "Classifying…",
    itemsAiTagNothing: "Nothing needs classifying",
    itemsAiTagNoConfig: "AI is not configured, open settings",
    itemsAiTagNoCandidates: "No tags yet — create one first so the AI has somewhere to attach",
    itemsAiTagNoSuggestion: "The AI returned no usable tags this time, try again later",
    itemsAiTagPreviewTitle: "AI suggested tags",
    itemsAiTagPreviewDesc: "Only untagged items are listed. Unticked items are not written; cancelling writes nothing.",
    itemsAiTagApply: (count) => `Apply (${count})`,
    itemsAiTagNothingSelected: "No items selected",
    itemsAiTagSkipRow: "Do not write this one",
    itemsAiTagResult: (written, skipped) =>
      skipped > 0 ? `Wrote ${written}, skipped ${skipped}` : `Wrote ${written}`,
    itemsAiTagSkippedRows: (count) => `${count} more got no suggestion and stay untouched`,
    itemsAiTagUndo: "Undo this tagging",
    itemsAiTagUndone: (count) => `Undid ${count} taggings`,
  },
  "ru-RU": {
    timelineNewItem: "Новое дело",
    timelineEditItem: "Изменить дело",
    timelineManageItems: "Управление делами",
    timelineCreateTitle: "Новое дело",
    timelineCreatePlaceholder: "Название дела",
    timelineCategoryLabel: "Категория",
    timelineCategoryNone: "Без категории",
    timelineManageCategories: "Управление категориями",
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
    timelineEditEmpty: "В сегодняшней ленте пока пусто — сначала добавьте дело кнопкой «Новое дело».",
    timelineRecentEmpty: "Недавних дел пока нет",
    timelineTimerInvalid: "Длительность от 1 до 1440 минут",
    timelineNameEmpty: "Название не может быть пустым",
    timelineNameTooLong: (max) => `Не более ${max} символов`,
    timelineSaveFailed: "Не отправлено, повторите",
    timelineTotal: (text) => `Всего ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · идёт`,
    timelineChildrenToggle: (count) => `Показать дочерние записи: ${count}`,
    timelineChildrenCollapse: "Скрыть дочерние записи",
    timelineUnmeasured: (range) => `Не записано ${range}`,
    editRecordTime: "Изменить время",
    recordStartLabel: "Время начала",
    recordEndLabel: "Время конца",
    onlySavedEditable: "Идущую запись можно изменить только после её завершения",
    recordZeroLength: "Начало и конец не могут быть одним моментом",
    endBeforeStart: "Конец должен быть позже начала",
    crossDayHint: "Запись через полночь нужно разделить на два дня",
    recordSaved: "Сохранено, вступит в силу после обновления",
    recordSaveFailed: "Не отправлено, повторите",
    itemsManageTitle: "Частые и прошлые",
    itemsTitle: "Хронология дня",
    itemsPinnedGroup: "Частые дела",
    itemsRecentGroup: "Прошлые дела",
    itemsEmpty: "Дел пока нет · нажмите «Добавить»",
    itemsTimelineEmpty: "Сегодня отсчётов нет",
    itemsDividerLabel: "Разделитель между задачами и хронологией дня",
    itemsNewAction: "Добавить",
    itemsAiTag: "Разметка ИИ одним нажатием",
    itemsBoundMark: "Приложение привязано",
    itemsStartTimer: (name) => `Начать отсчёт: ${name}`,
    itemsStopTimer: (name) => `Остановить отсчёт: ${name}`,
    itemsTimerStarted: (name) => `Отсчёт начат: ${name}`,
    itemsTimerStopped: (name) => `Отсчёт остановлен: ${name}`,
    itemsTimerSendFailed: "Не удалось связаться с таймером, нажмите ещё раз",
    itemsAiTagBusy: "Идёт разметка…",
    itemsAiTagNothing: "Нет дел, которые нужно размечать",
    itemsAiTagNoConfig: "ИИ не настроен, откройте настройки",
    itemsAiTagNoCandidates: "Тегов пока нет — создайте тег, чтобы ИИ было куда его поставить",
    itemsAiTagNoSuggestion: "ИИ не предложил подходящих тегов, повторите позже",
    itemsAiTagPreviewTitle: "ИИ предлагает теги",
    itemsAiTagPreviewDesc: "Показаны только дела без тегов. Снятые отметки не записываются, отмена не пишет ничего.",
    itemsAiTagApply: (count) => `Применить (${count})`,
    itemsAiTagNothingSelected: "Ничего не отмечено",
    itemsAiTagSkipRow: "Не записывать это",
    itemsAiTagResult: (written, skipped) =>
      skipped > 0 ? `Записано ${written}, пропущено ${skipped}` : `Записано ${written}`,
    itemsAiTagSkippedRows: (count) => `Ещё ${count} без предложений, остаются как есть`,
    itemsAiTagUndo: "Отменить эту разметку",
    itemsAiTagUndone: (count) => `Отменено разметок: ${count}`,
  },
  es: {
    timelineNewItem: "Nuevo asunto",
    timelineEditItem: "Editar asunto",
    timelineManageItems: "Gestionar asuntos",
    timelineCreateTitle: "Nuevo asunto",
    timelineCreatePlaceholder: "Nombre del asunto",
    timelineCategoryLabel: "Categoría",
    timelineCategoryNone: "Sin categoría",
    timelineManageCategories: "Gestionar categorías",
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
    timelineEditEmpty: "La línea de hoy está vacía: crea un asunto con «Nuevo asunto».",
    timelineRecentEmpty: "Aún no hay asuntos recientes",
    timelineTimerInvalid: "La duración debe ser 1–1440 minutos",
    timelineNameEmpty: "El nombre no puede estar vacío",
    timelineNameTooLong: (max) => `Máximo ${max} caracteres`,
    timelineSaveFailed: "No se envió, inténtalo de nuevo",
    timelineTotal: (text) => `Total ${text}`,
    timelineRange: (start, end) => `${start}–${end}`,
    timelineNoEnd: (clock) => `${clock} · en curso`,
    timelineChildrenToggle: (count) => `Mostrar ${count} registros hijos`,
    timelineChildrenCollapse: "Ocultar registros hijos",
    timelineUnmeasured: (range) => `Sin capturar ${range}`,
    editRecordTime: "Editar horas",
    recordStartLabel: "Hora de inicio",
    recordEndLabel: "Hora de fin",
    onlySavedEditable: "Un registro en curso solo puede editarse cuando termine",
    recordZeroLength: "El inicio y el fin no pueden ser el mismo instante",
    endBeforeStart: "La hora de fin debe ser posterior al inicio",
    crossDayHint: "Un registro que cruza la medianoche debe repartirse en dos días",
    recordSaved: "Guardado, surte efecto tras la próxima actualización",
    recordSaveFailed: "No se envió, inténtalo de nuevo",
    itemsManageTitle: "Frecuentes y anteriores",
    itemsTitle: "Cronología de hoy",
    itemsPinnedGroup: "Asuntos frecuentes",
    itemsRecentGroup: "Asuntos anteriores",
    itemsEmpty: "Aún no hay asuntos · usa «Nuevo» para crear uno",
    itemsTimelineEmpty: "Hoy no hay tiempo registrado",
    itemsDividerLabel: "Separador entre los pendientes y la cronología de hoy",
    itemsNewAction: "Nuevo",
    itemsAiTag: "Clasificación con IA en un clic",
    itemsBoundMark: "Aplicación vinculada",
    itemsStartTimer: (name) => `Iniciar cronómetro: ${name}`,
    itemsStopTimer: (name) => `Detener cronómetro: ${name}`,
    itemsTimerStarted: (name) => `Cronómetro iniciado: ${name}`,
    itemsTimerStopped: (name) => `Cronómetro detenido: ${name}`,
    itemsTimerSendFailed: "No se pudo avisar al cronómetro, inténtalo otra vez",
    itemsAiTagBusy: "Clasificando…",
    itemsAiTagNothing: "No hay asuntos que clasificar",
    itemsAiTagNoConfig: "La IA no está configurada, abre los ajustes",
    itemsAiTagNoCandidates: "Aún no hay etiquetas: crea una para que la IA tenga dónde ponerla",
    itemsAiTagNoSuggestion: "La IA no propuso etiquetas utilizables, inténtalo más tarde",
    itemsAiTagPreviewTitle: "Etiquetas sugeridas por la IA",
    itemsAiTagPreviewDesc: "Solo se listan asuntos sin etiquetas. Los no marcados no se escriben; cancelar no escribe nada.",
    itemsAiTagApply: (count) => `Aplicar (${count})`,
    itemsAiTagNothingSelected: "No hay ningún asunto marcado",
    itemsAiTagSkipRow: "No escribir este",
    itemsAiTagResult: (written, skipped) =>
      skipped > 0 ? `Escritos ${written}, omitidos ${skipped}` : `Escritos ${written}`,
    itemsAiTagSkippedRows: (count) => `Otros ${count} sin sugerencia se quedan igual`,
    itemsAiTagUndo: "Deshacer esta clasificación",
    itemsAiTagUndone: (count) => `Clasificaciones deshechas: ${count}`,
  },
};
