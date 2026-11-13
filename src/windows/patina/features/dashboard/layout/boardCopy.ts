/**
 * [v3] 组件板的文案（四语言齐备）。
 *
 * 为什么不进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的位置数组，
 * 手插一行会让其后全部文案错位；`generated/contract.ts` 还在 size-allowlist 里冻结着。
 * 同 `../copy.ts` 的纪律：组件侧自有表，且**必须四键齐全**（ru / es 不许静默降级成英文）。
 *
 * [0.13 · 需求 1.3 / 1.4] 本轮键集的两处结构性变化：
 *   · **删 9 键**：`reset` / `saveLayout` / `saveHint` / `savedAsDefault` / `saveEmpty` /
 *     `resetToSaved` / `factory` / `factoryHint` / `factoryDone` —— 工具栏只留三入口，
 *     「恢复默认 / 保存布局 / 出厂布局」三颗按钮随 `boardStore.reset` 一起下线；
 *   · **加 18 键**：布局管理弹层（列表 / 切换 / 删除 / 新建 / 整理）、锁定文案。
 *     「出厂布局」不再是动作，而是库里的**内置条目**（`factoryLayoutName`）。
 *   · `tidy` 保留：它从工具栏搬进了布局管理弹层（「卡拖乱了」的唯一退路，不能删）。
 */
import type { Locale } from "../../../shared/i18n/index.ts";
import type { CardTier } from "./contract";

export interface BoardCopy {
  addCard: string;
  addTitle: string;
  addNote: string;
  onBoard: (count: number) => string;
  /** 整理当前布局（工具栏已无这颗键，入口在布局管理弹层） */
  tidy: string;
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
  /** 工具条这一组键的无障碍名字（`role="toolbar"` 没有名字时读屏只会念「工具条」） */
  toolbarLabel: string;

  /* ── 布局管理（弹层） ── */
  manageLayout: string;
  /** 工具条那颗键的悬停说明 */
  manageHint: string;
  /** 弹层里「新建布局」 */
  newLayout: string;
  newLayoutHint: string;
  switchTo: string;
  deleteLayout: string;
  /** 删除的二次确认（第一次点变成这颗，再点才真删） */
  deleteConfirm: string;
  /** 新布局的默认名（可重名，不做重命名） */
  layoutName: (index: number) => string;
  layoutCount: (count: number) => string;
  layoutSaved: (name: string) => string;
  layoutDeleted: (name: string) => string;
  /** 库里那条内置条目的名字（不可删、不可改名） */
  factoryLayoutName: string;

  /* ── 锁定（几何锁 + 结构锁） ── */
  lockLayout: string;
  unlockLayout: string;
  layoutLocked: string;
  layoutUnlocked: string;
  /** 锁定态下弹层里那句解释：为什么有些键点不动 */
  lockedHint: string;
  /** 锁定态下试图改结构时的一句回应（弹层的守卫用） */
  lockedNotice: string;

  /* ── 设置页「主界面组件」面板（[本轮 T05] T02 的中文字面量纳入四语言表） ── */
  boardPanelTitle: string;
  boardPanelHint: string;
  boardPanelEmpty: string;
  snapTitle: string;
  snapHint: string;
  tidyHint: string;
  layoutLibTitle: string;
  layoutLibHint: string;
  restoreSaved: string;
  /** 行尾「移除」键的无障碍名字（`移除 「{label}」`） */
  removeNamed: (label: string) => string;
  /** 尺寸按钮组的无障碍名字（`{label} 尺寸`） */
  sizeNamed: (label: string) => string;
}

export const BOARD_COPY: Record<Locale, BoardCopy> = {
  "zh-CN": {
    addCard: "＋ 添加组件",
    addTitle: "添加组件",
    addNote: "同一种组件可以放多张 · 新卡落在第一块空地上",
    onBoard: (count) => (count > 0 ? `板上 ${count} 张` : "未添加"),
    tidy: "整理",
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
    toolbarLabel: "组件板工具条",
    manageLayout: "布局管理",
    manageHint: "查看 / 切换 / 删除 / 新建布局，也可以整理当前布局",
    newLayout: "＋ 新建布局",
    newLayoutHint: "把当前排布存成一条新布局",
    switchTo: "切换",
    deleteLayout: "删除",
    deleteConfirm: "确认删除",
    layoutName: (index) => `布局 ${index}`,
    layoutCount: (count) => `共 ${count} 条`,
    layoutSaved: (name) => `已保存为「${name}」`,
    layoutDeleted: (name) => `已删除「${name}」`,
    factoryLayoutName: "出厂布局",
    lockLayout: "锁定布局",
    unlockLayout: "解锁布局",
    layoutLocked: "布局已锁定 · 拖动与尺寸不再响应",
    layoutUnlocked: "布局已解锁 · 现在可以拖动与改尺寸",
    lockedHint: "锁定中：拖动 / 尺寸 / 整理 / 添加与移除组件 / 切换与新建布局都已禁用；改卡标题与卡内参数仍可用",
    lockedNotice: "布局已锁定 · 先解锁再改",
    boardPanelTitle: "主界面组件",
    boardPanelHint: "组件板是自由摆位：在主界面拖卡头挪位置、拖右缘下缘改尺寸，位置会记住。这里管的是有哪些组件与全局手感。",
    boardPanelEmpty: "板子是空的。点右上「添加组件」放一张，主界面才有内容。",
    snapTitle: "8px 对齐",
    snapHint: "拖动与缩放时吸附到 8px 网格。关掉后按 1px 精度移动，适合卡着像素对齐。",
    tidyHint: "把现有组件按三列重新排紧凑（exe 的装箱算法）。",
    layoutLibTitle: "布局库",
    layoutLibHint: "「新建布局」把当前排布存成库里的一条；「回到已存版本」把面板还原成当前这条布局上次保存的样子；「出厂布局」回到内置排布。完整的列表 / 切换 / 删除在主界面左上角的「布局管理」里。",
    restoreSaved: "回到已存版本",
    removeNamed: (label) => `移除「${label}」`,
    sizeNamed: (label) => `${label} 尺寸`,
  },
  "en-US": {
    addCard: "＋ Add widget",
    addTitle: "Add widget",
    addNote: "The same widget can appear more than once · new cards land in the first free spot",
    onBoard: (count) => (count > 0 ? `${count} on board` : "Not added"),
    tidy: "Tidy",
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
    toolbarLabel: "Board toolbar",
    manageLayout: "Layouts",
    manageHint: "View, switch, delete or create layouts — you can also tidy the current one",
    newLayout: "＋ New layout",
    newLayoutHint: "Save the current arrangement as a new layout",
    switchTo: "Switch",
    deleteLayout: "Delete",
    deleteConfirm: "Delete it",
    layoutName: (index) => `Layout ${index}`,
    layoutCount: (count) => `${count} saved`,
    layoutSaved: (name) => `Saved as “${name}”`,
    layoutDeleted: (name) => `“${name}” deleted`,
    factoryLayoutName: "Factory layout",
    lockLayout: "Lock layout",
    unlockLayout: "Unlock layout",
    layoutLocked: "Layout locked · dragging and resizing are off",
    layoutUnlocked: "Layout unlocked · dragging and resizing are back",
    lockedHint: "Locked: dragging, resizing, tidying, adding or removing widgets, switching and creating layouts are off. Renaming a widget and its options still work.",
    lockedNotice: "The layout is locked · unlock it first",
    boardPanelTitle: "Main board widgets",
    boardPanelHint: "The board is free-form: drag a card header to move it, drag its edge to resize — positions are remembered. This panel manages which widgets exist and the global feel.",
    boardPanelEmpty: "The board is empty. Use “Add widget” (top right) to place one.",
    snapTitle: "8px snapping",
    snapHint: "Dragging and resizing snap to an 8px grid. Turn it off for 1px precision.",
    tidyHint: "Repack the current widgets into the three columns (the exe's packing algorithm).",
    layoutLibTitle: "Layouts",
    layoutLibHint: "“New layout” saves the current arrangement into the library; “Restore saved” reverts the board to the last saved state of the active layout; “Factory layout” returns to the built-in one. The full list, switching and deleting live in “Layouts” on the board.",
    restoreSaved: "Restore saved",
    removeNamed: (label) => `Remove ${label}`,
    sizeNamed: (label) => `${label} size`,
  },
  "ru-RU": {
    addCard: "＋ Добавить виджет",
    addTitle: "Добавить виджет",
    addNote: "Один и тот же виджет можно добавить несколько раз · новая карточка встанет в первое свободное место",
    onBoard: (count) => (count > 0 ? `На доске: ${count}` : "Не добавлено"),
    tidy: "Упорядочить",
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
    toolbarLabel: "Панель инструментов доски",
    manageLayout: "Раскладки",
    manageHint: "Просмотр, переключение, удаление и создание раскладок; текущую можно упорядочить",
    newLayout: "＋ Новая раскладка",
    newLayoutHint: "Сохранить текущее расположение как новую раскладку",
    switchTo: "Переключить",
    deleteLayout: "Удалить",
    deleteConfirm: "Удалить",
    layoutName: (index) => `Раскладка ${index}`,
    layoutCount: (count) => `Всего: ${count}`,
    layoutSaved: (name) => `Сохранено как «${name}»`,
    layoutDeleted: (name) => `«${name}» удалена`,
    factoryLayoutName: "Заводская раскладка",
    lockLayout: "Закрепить раскладку",
    unlockLayout: "Открепить раскладку",
    layoutLocked: "Раскладка закреплена · перетаскивание и размер отключены",
    layoutUnlocked: "Раскладка откреплена · перетаскивание снова работает",
    lockedHint: "Закреплено: перетаскивание, размер, упорядочивание, добавление и удаление виджетов, переключение и создание раскладок отключены. Заголовок виджета и его параметры по-прежнему доступны.",
    lockedNotice: "Раскладка закреплена · сначала открепите её",
    boardPanelTitle: "Виджеты главного экрана",
    boardPanelHint: "Доска свободная: тяните заголовок карточки, чтобы передвинуть, край — чтобы изменить размер; положение запоминается. Здесь управляют составом виджетов и общей настройкой.",
    boardPanelEmpty: "Доска пуста. Нажмите «Добавить виджет» (справа вверху).",
    snapTitle: "Шаг 8px",
    snapHint: "При перетаскивании и изменении размера шаг сетки 8px. Выключите — точность 1px.",
    tidyHint: "Плотно разложить текущие виджеты по трём колонкам (алгоритм упаковки из exe).",
    layoutLibTitle: "Раскладки",
    layoutLibHint: "«Новая раскладка» сохранит текущее расположение в библиотеку; «Вернуть сохранённое» откатит доску к последнему сохранённому виду текущей раскладки; «Заводская раскладка» вернёт встроенную. Полный список, переключение и удаление — в «Раскладках» на доске.",
    restoreSaved: "Вернуть сохранённое",
    removeNamed: (label) => `Удалить «${label}»`,
    sizeNamed: (label) => `Размер «${label}»`,
  },
  es: {
    addCard: "＋ Añadir tarjeta",
    addTitle: "Añadir tarjeta",
    addNote: "La misma tarjeta puede repetirse · la nueva ocupa el primer hueco libre",
    onBoard: (count) => (count > 0 ? `${count} en el tablero` : "Sin añadir"),
    tidy: "Ordenar",
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
    toolbarLabel: "Barra del tablero",
    manageLayout: "Diseños",
    manageHint: "Ver, cambiar, eliminar o crear diseños; también puedes ordenar el actual",
    newLayout: "＋ Nuevo diseño",
    newLayoutHint: "Guardar la disposición actual como un diseño nuevo",
    switchTo: "Cambiar",
    deleteLayout: "Eliminar",
    deleteConfirm: "Eliminar",
    layoutName: (index) => `Diseño ${index}`,
    layoutCount: (count) => `${count} en total`,
    layoutSaved: (name) => `Guardado como «${name}»`,
    layoutDeleted: (name) => `«${name}» eliminado`,
    factoryLayoutName: "Diseño de fábrica",
    lockLayout: "Bloquear diseño",
    unlockLayout: "Desbloquear diseño",
    layoutLocked: "Diseño bloqueado · arrastrar y redimensionar están desactivados",
    layoutUnlocked: "Diseño desbloqueado · arrastrar y redimensionar vuelven",
    lockedHint: "Bloqueado: arrastrar, redimensionar, ordenar, añadir o quitar tarjetas, cambiar y crear diseños están desactivados. El título de la tarjeta y sus opciones siguen disponibles.",
    lockedNotice: "El diseño está bloqueado · desbloquéalo primero",
    boardPanelTitle: "Tarjetas del tablero",
    boardPanelHint: "El tablero es libre: arrastra la cabecera para mover una tarjeta y su borde para redimensionar; la posición se recuerda. Aquí se gestionan qué tarjetas existen y el ajuste global.",
    boardPanelEmpty: "El tablero está vacío. Usa «Añadir tarjeta» (arriba a la derecha).",
    snapTitle: "Ajuste de 8px",
    snapHint: "Al arrastrar y redimensionar se ajusta a una rejilla de 8px. Desactívalo para precisión de 1px.",
    tidyHint: "Reacomoda las tarjetas en las tres columnas (el algoritmo de empaquetado del exe).",
    layoutLibTitle: "Diseños",
    layoutLibHint: "«Nuevo diseño» guarda la disposición actual en la biblioteca; «Restaurar guardado» devuelve el tablero al último estado guardado del diseño activo; «Diseño de fábrica» vuelve al integrado. La lista completa, el cambio y el borrado están en «Diseños» del tablero.",
    restoreSaved: "Restaurar guardado",
    removeNamed: (label) => `Quitar ${label}`,
    sizeNamed: (label) => `Tamaño de ${label}`,
  },
};
