/**
 * [v3] 组件板的文案（四语言齐备）。
 *
 * 为什么不进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的位置数组，
 * 手插一行会让其后全部文案错位；`generated/contract.ts` 还在 size-allowlist 里冻结着。
 * 同 `../copy.ts` 的纪律：组件侧自有表，且**必须四键齐全**（ru / es 不许静默降级成英文）。
 */
import type { Locale } from "../../../shared/i18n/index.ts";
import type { CardTier } from "./contract";

export interface BoardCopy {
  addCard: string;
  addTitle: string;
  addNote: string;
  onBoard: (count: number) => string;
  tidy: string;
  reset: string;
  /** 把当前布局存为默认（存完「恢复默认」就回这一版） */
  saveLayout: string;
  /** 鼠标悬停说明：存的是什么、之后会发生什么 */
  saveHint: string;
  savedAsDefault: string;
  /** 板子空着时点「保存布局」的回应 */
  saveEmpty: string;
  resetToSaved: string;
  /** 只在存过自定义默认版时出现：回出厂排布（不删已存的默认版） */
  factory: string;
  factoryHint: string;
  factoryDone: string;
  more: (label: string) => string;
  rename: string;
  renamePlaceholder: string;
  size: string;
  sizes: Record<CardTier, string>;
  duplicate: string;
  remove: string;
  close: string;
  empty: string;
  drag: (label: string) => string;
  resizeWidth: (label: string) => string;
  resizeHeight: (label: string) => string;
  resizeBoth: (label: string) => string;
  movedBelow: (label: string) => string;
  /** 首屏之外还有卡时的一句提示（屏幕阅读器也要知道板子往哪长） */
  boardHint: string;
}

export const BOARD_COPY: Record<Locale, BoardCopy> = {
  "zh-CN": {
    addCard: "＋ 添加组件",
    addTitle: "添加组件",
    addNote: "同一种组件可以放多张 · 新卡落在第一块空地上",
    onBoard: (count) => (count > 0 ? `板上 ${count} 张` : "未添加"),
    tidy: "整理",
    reset: "恢复默认",
    saveLayout: "保存布局",
    saveHint: "把当前布局设为默认 · 之后「恢复默认」回到这一版",
    savedAsDefault: "已保存为默认布局 · 之后「恢复默认」回到这一版",
    saveEmpty: "板子是空的 · 先放一张组件再存",
    resetToSaved: "已恢复你保存的默认布局",
    factory: "出厂布局",
    factoryHint: "回到出厂排布 · 不影响你保存的默认布局",
    factoryDone: "已恢复出厂布局 · 「保存布局」可再存一次",
    more: (label) => `${label} 菜单`,
    rename: "标题",
    renamePlaceholder: "留空恢复默认名",
    size: "尺寸",
    sizes: { S: "小", M: "中", L: "大" },
    duplicate: "复制一份",
    remove: "移除",
    close: "关闭",
    empty: "板子是空的 · 点「添加组件」放一张",
    drag: (label) => `拖动「${label}」`,
    resizeWidth: (label) => `调整「${label}」宽度`,
    resizeHeight: (label) => `调整「${label}」高度`,
    resizeBoth: (label) => `同时调整「${label}」宽高`,
    movedBelow: (label) => `「${label}」落在首屏下方 · 向下滚动可见`,
    boardHint: "滚轮翻动 · Ctrl + 滚轮缩放整块板 · 拖卡头挪位，拖右缘下缘改尺寸",
  },
  "en-US": {
    addCard: "＋ Add widget",
    addTitle: "Add widget",
    addNote: "The same widget can appear more than once · new cards land in the first free spot",
    onBoard: (count) => (count > 0 ? `${count} on board` : "Not added"),
    tidy: "Tidy",
    reset: "Restore defaults",
    saveLayout: "Save layout",
    saveHint: "Use the current layout as the default · “Restore defaults” returns to it",
    savedAsDefault: "Saved as your default layout · “Restore defaults” now returns to it",
    saveEmpty: "The board is empty · add a widget before saving",
    resetToSaved: "Your saved default layout is back",
    factory: "Factory layout",
    factoryHint: "Back to the factory arrangement · your saved default is kept",
    factoryDone: "Factory layout restored · use “Save layout” to store a new default",
    more: (label) => `${label} menu`,
    rename: "Title",
    renamePlaceholder: "Leave empty for the default name",
    size: "Size",
    sizes: { S: "S", M: "M", L: "L" },
    duplicate: "Duplicate",
    remove: "Remove",
    close: "Close",
    empty: "The board is empty · use “Add widget” to place one",
    drag: (label) => `Drag ${label}`,
    resizeWidth: (label) => `Resize ${label} width`,
    resizeHeight: (label) => `Resize ${label} height`,
    resizeBoth: (label) => `Resize ${label} width and height`,
    movedBelow: (label) => `${label} was placed below the fold · scroll down to see it`,
    boardHint: "Scroll to pan · Ctrl + wheel to zoom the whole board · drag a card header to move it, its edge to resize",
  },
  "ru-RU": {
    addCard: "＋ Добавить виджет",
    addTitle: "Добавить виджет",
    addNote: "Один и тот же виджет можно добавить несколько раз · новая карточка встанет в первое свободное место",
    onBoard: (count) => (count > 0 ? `На доске: ${count}` : "Не добавлено"),
    tidy: "Упорядочить",
    reset: "Сбросить",
    saveLayout: "Сохранить раскладку",
    saveHint: "Сделать текущую раскладку раскладкой по умолчанию · «Сбросить» вернёт её",
    savedAsDefault: "Сохранено как раскладка по умолчанию · «Сбросить» вернёт её",
    saveEmpty: "Доска пуста · сначала добавьте виджет",
    resetToSaved: "Восстановлена ваша раскладка по умолчанию",
    factory: "Заводская раскладка",
    factoryHint: "Вернуться к заводскому расположению · сохранённая по умолчанию останется",
    factoryDone: "Заводская раскладка восстановлена · «Сохранить раскладку» сохранит новую",
    more: (label) => `Меню «${label}»`,
    rename: "Заголовок",
    renamePlaceholder: "Пусто — имя по умолчанию",
    size: "Размер",
    sizes: { S: "S", M: "M", L: "L" },
    duplicate: "Дублировать",
    remove: "Удалить",
    close: "Закрыть",
    empty: "Доска пуста · нажмите «Добавить виджет»",
    drag: (label) => `Перетащить «${label}»`,
    resizeWidth: (label) => `Ширина «${label}»`,
    resizeHeight: (label) => `Высота «${label}»`,
    resizeBoth: (label) => `Ширина и высота «${label}»`,
    movedBelow: (label) => `«${label}» ниже первого экрана · прокрутите вниз`,
    boardHint: "Колесо — прокрутка · Ctrl + колесо — масштаб всей доски · тяните заголовок карточки, край — размер",
  },
  es: {
    addCard: "＋ Añadir tarjeta",
    addTitle: "Añadir tarjeta",
    addNote: "La misma tarjeta puede repetirse · la nueva ocupa el primer hueco libre",
    onBoard: (count) => (count > 0 ? `${count} en el tablero` : "Sin añadir"),
    tidy: "Ordenar",
    reset: "Restablecer",
    saveLayout: "Guardar diseño",
    saveHint: "Usar el diseño actual como predeterminado · «Restablecer» vuelve a él",
    savedAsDefault: "Guardado como diseño predeterminado · «Restablecer» vuelve a él",
    saveEmpty: "El tablero está vacío · añade una tarjeta antes de guardar",
    resetToSaved: "Restaurado tu diseño predeterminado",
    factory: "Diseño de fábrica",
    factoryHint: "Volver a la disposición de fábrica · conserva tu predeterminado",
    factoryDone: "Diseño de fábrica restaurado · «Guardar diseño» crea otro predeterminado",
    more: (label) => `Menú de ${label}`,
    rename: "Título",
    renamePlaceholder: "Vacío para el nombre por defecto",
    size: "Tamaño",
    sizes: { S: "S", M: "M", L: "L" },
    duplicate: "Duplicar",
    remove: "Quitar",
    close: "Cerrar",
    empty: "El tablero está vacío · usa «Añadir tarjeta»",
    drag: (label) => `Arrastrar ${label}`,
    resizeWidth: (label) => `Ancho de ${label}`,
    resizeHeight: (label) => `Alto de ${label}`,
    resizeBoth: (label) => `Ancho y alto de ${label}`,
    movedBelow: (label) => `${label} quedó debajo del primer pantallazo · desplázate`,
    boardHint: "Rueda para desplazar · Ctrl + rueda para escalar el tablero · arrastra la cabecera para mover y el borde para redimensionar",
  },
};
