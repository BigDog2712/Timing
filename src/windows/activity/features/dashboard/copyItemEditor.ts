import type { Locale } from "../../shared/i18n/index.ts";

/** 事项编辑（新建 / 行编辑）新增控件的文案：标签、计时方式、创建后开始、绑定应用。 */
export interface ItemEditorCopy {
  tagsLabel: string;
  tagsPlaceholder: string;
  tagRemove: (tag: string) => string;
  tagAi: string;
  tagBusy: string;
  tagLimit: (max: number) => string;
  tagExists: string;
  tagInvalid: string;
  tagAiNone: string;
  tagAiCreated: (tags: string) => string;
  /** 本地记忆直接命中（没调模型）：告诉用户这几个标签来自他以前打过的那条 */
  tagAiMemory: (tags: string) => string;
  timerModeLabel: string;
  timerUp: string;
  timerDown: string;
  timerRequired: string;
  startAfterCreate: string;
  editItemLabel: (name: string) => string;
  appsLabel: string;
  pickApp: string;
}

export const ITEM_EDITOR_COPY: Record<Locale, ItemEditorCopy> = {
  "zh-CN": {
    tagsLabel: "标签",
    tagsPlaceholder: "回车添加，如 学习/考公",
    tagRemove: (tag) => `移除标签 #${tag}`,
    tagAi: "AI",
    tagBusy: "建议中…",
    tagLimit: (max) => `最多 ${max} 个标签`,
    tagExists: "这个标签已经有了",
    tagInvalid: "标签不合法",
    tagAiNone: "AI 没有给出更合适的标签",
    tagAiCreated: (tags) => `AI 新建了 ${tags}`,
    tagAiMemory: (tags) => `按记忆填入 ${tags}（没调用模型）`,
    timerModeLabel: "计时方式",
    timerUp: "正计时",
    timerDown: "倒计时",
    timerRequired: "选了倒计时就要填分钟数",
    startAfterCreate: "创建后开始",
    editItemLabel: (name) => `编辑事项：${name}`,
    appsLabel: "绑定应用",
    pickApp: "选择应用（可选）",
  },
  "en-US": {
    tagsLabel: "Tags",
    tagsPlaceholder: "Press Enter, e.g. Study/Exam",
    tagRemove: (tag) => `Remove tag #${tag}`,
    tagAi: "AI",
    tagBusy: "Suggesting…",
    tagLimit: (max) => `At most ${max} tags`,
    tagExists: "That tag is already added",
    tagInvalid: "Invalid tag",
    tagAiNone: "AI had no better tag",
    tagAiCreated: (tags) => `AI created ${tags}`,
    tagAiMemory: (tags) => `Filled ${tags} from memory (no model call)`,
    timerModeLabel: "Timer",
    timerUp: "Count up",
    timerDown: "Count down",
    timerRequired: "Enter minutes for count down",
    startAfterCreate: "Start after creating",
    editItemLabel: (name) => `Edit: ${name}`,
    appsLabel: "Bound apps",
    pickApp: "Pick an app (optional)",
  },
  "ru-RU": {
    tagsLabel: "Теги",
    tagsPlaceholder: "Enter, напр. Учёба/Экзамен",
    tagRemove: (tag) => `Удалить тег #${tag}`,
    tagAi: "AI",
    tagBusy: "Подбор…",
    tagLimit: (max) => `Не больше ${max} тегов`,
    tagExists: "Такой тег уже есть",
    tagInvalid: "Недопустимый тег",
    tagAiNone: "AI не предложил лучший тег",
    tagAiCreated: (tags) => `AI создал ${tags}`,
    tagAiMemory: (tags) => `Заполнено из памяти: ${tags} (без вызова модели)`,
    timerModeLabel: "Режим",
    timerUp: "Прямой отсчёт",
    timerDown: "Обратный отсчёт",
    timerRequired: "Укажите минуты для обратного отсчёта",
    startAfterCreate: "Запустить после создания",
    editItemLabel: (name) => `Изменить: ${name}`,
    appsLabel: "Связанные приложения",
    pickApp: "Выберите приложение (необязательно)",
  },
  es: {
    tagsLabel: "Etiquetas",
    tagsPlaceholder: "Enter, p. ej. Estudio/Examen",
    tagRemove: (tag) => `Quitar etiqueta #${tag}`,
    tagAi: "IA",
    tagBusy: "Sugiriendo…",
    tagLimit: (max) => `Máximo ${max} etiquetas`,
    tagExists: "Esa etiqueta ya está",
    tagInvalid: "Etiqueta no válida",
    tagAiNone: "La IA no propuso una etiqueta mejor",
    tagAiCreated: (tags) => `La IA creó ${tags}`,
    tagAiMemory: (tags) => `Rellenado ${tags} desde la memoria (sin llamar al modelo)`,
    timerModeLabel: "Modo",
    timerUp: "Cronómetro",
    timerDown: "Cuenta atrás",
    timerRequired: "Indica minutos para la cuenta atrás",
    startAfterCreate: "Iniciar al crear",
    editItemLabel: (name) => `Editar: ${name}`,
    appsLabel: "Aplicaciones vinculadas",
    pickApp: "Elige una aplicación (opcional)",
  },
};
