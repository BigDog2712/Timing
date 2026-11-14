import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 「应用设置」弹窗（双击应用趋势里的一行打开）的四语言文案。
 *
 * 为什么不进 `src/windows/patina/shared/i18n/generated/contract.ts`：那四个 locale 文件
 * 是按索引对齐的**位置数组**，手插一行会让其后全部文案错位，而且 `contract.ts` 现在
 * 被 size 门禁冻在 1131 行、**零余量**。本仓已有两个同型先例（`dashboard/copyTodos.ts`、
 * `classification/categoryAdminCopy.ts`）：一个 `Record<Locale, ...>` 自成一册。
 *
 * 能复用既有 `UI_TEXT` 的一律复用（保存 / 取消 / 新建分类 / 改名 / 删除 / 颜色），
 * 这里只放**这个弹窗才有**的说法。
 */
export interface AppEditCopy {
  /** 弹窗标题（应用名作为副标题一起画，这里只给"设置"那半句） */
  title: string;
  categories: string;
  /** 一句话说清"勾多个 = 这个应用同时属于这些分类"，以及第一个是主分类 */
  categoriesHint: string;
  /** 主分类的角标（短，占一格里的一小段） */
  primaryBadge: string;
  /** 把某个已勾选的分类提到首位 */
  setPrimary: string;
  items: string;
  itemsHint: string;
  itemsEmpty: string;
  /** 事项清单读不到（`listTimingItems()` 失败）：只降级这一栏 */
  itemsLoadFailed: string;
  /** 事项不指定分类时的归属说明 */
  followPrimary: string;
  manage: string;
  /** [本轮] 数据页分类 tab 的入口按钮 → 独立弹窗（「管理分类」） */
  manageAction: string;
  /** 独立弹窗顶部那句话：这个弹窗能做什么、删了会怎样 */
  manageHint: string;
  /** 「已删除」那一行前面的说明（这些分类只能从这里恢复） */
  deletedHint: string;
  /** 分类管理里每行的用量：多少个应用/域名正指着它（判断删除影响面） */
  usageCount: (count: number) => string;
  /**
   * [本轮] 新建行色块处于"未选"状态时的那行小字 + 该色块的 tooltip：
   * 说明色块上画的是**预览色**、用户没选色就不写覆盖（分类按调色板自动取色）。
   */
  createColorHint: string;
  loadFailed: string;
  saveFailed: string;
}

export const APP_EDIT_COPY: Record<Locale, AppEditCopy> = {
  "zh-CN": {
    title: "应用设置",
    categories: "分类",
    categoriesHint: "可勾选多个分类，第一个为主分类。分类的增删改在「分类」页的「管理分类」里。",
    primaryBadge: "主",
    setPrimary: "设为主分类",
    items: "绑定事项",
    itemsHint: "勾选这个应用平时在做的事项，并指定它们归属的分类。",
    itemsEmpty: "还没有可选的事项",
    itemsLoadFailed: "暂时读不到事项",
    followPrimary: "跟随主分类",
    manage: "分类管理",
    manageAction: "管理分类",
    manageHint: "新建、改名、换色、删除都在这里。内置分类也能删，只有「未分类」不行；删掉的分类在最下面可以恢复，其下的应用会回到「未分类」。",
    deletedHint: "已删除，点一下恢复：",
    usageCount: (count) => `${count} 个在用`,
    createColorHint: "不选色则按调色板自动取色（色块里现在是预览色，不会被记成你的选择）",
    loadFailed: "读取这个应用的设置失败",
    saveFailed: "保存失败，请重试",
  },
  "en-US": {
    title: "App settings",
    categories: "Categories",
    categoriesHint: "Pick any number of categories; the first one is primary. Create, rename and delete them under Manage categories on the Categories page.",
    primaryBadge: "Primary",
    setPrimary: "Make primary",
    items: "Bound items",
    itemsHint: "Pick the items you usually work on in this app, and which category each belongs to.",
    itemsEmpty: "No items yet",
    itemsLoadFailed: "Items are unavailable right now",
    followPrimary: "Follow primary",
    manage: "Manage categories",
    manageAction: "Manage categories",
    manageHint: "Create, rename, recolor and delete here. Built-in categories can be deleted too — only “Other” cannot; deleted ones can be restored at the bottom, and their apps fall back to “Other”.",
    deletedHint: "Deleted — click to restore:",
    usageCount: (count) => `${count} in use`,
    createColorHint: "Leave the swatch alone and the palette picks the colour (what you see is a preview, not your choice)",
    loadFailed: "Could not read the settings for this app",
    saveFailed: "Save failed, please try again",
  },
  "ru-RU": {
    title: "Настройки приложения",
    categories: "Категории",
    categoriesHint: "Можно выбрать несколько категорий; первая — основная. Создание, переименование и удаление — в «Управлении категориями» на странице категорий.",
    primaryBadge: "Осн.",
    setPrimary: "Сделать основной",
    items: "Связанные дела",
    itemsHint: "Отметьте дела, которые обычно выполняются в этом приложении, и их категории.",
    itemsEmpty: "Пока нет доступных дел",
    itemsLoadFailed: "Дела сейчас недоступны",
    followPrimary: "Как основная",
    manage: "Управление категориями",
    manageAction: "Управление категориями",
    manageHint: "Создавайте, переименовывайте, перекрашивайте и удаляйте здесь. Встроенные категории тоже можно удалить — кроме «Прочее»; удалённые восстанавливаются внизу, их приложения переходят в «Прочее».",
    deletedHint: "Удалены — нажмите, чтобы вернуть:",
    usageCount: (count) => `используется: ${count}`,
    createColorHint: "Не трогайте образец — цвет возьмётся из палитры (сейчас это предпросмотр, а не ваш выбор)",
    loadFailed: "Не удалось прочитать настройки приложения",
    saveFailed: "Не удалось сохранить, попробуйте ещё раз",
  },
  es: {
    title: "Ajustes de la aplicación",
    categories: "Categorías",
    categoriesHint: "Puedes marcar varias categorías; la primera es la principal. Crear, renombrar y eliminar se hace en Gestionar categorías, en la página de categorías.",
    primaryBadge: "Princ.",
    setPrimary: "Marcar como principal",
    items: "Asuntos vinculados",
    itemsHint: "Marca los asuntos habituales en esta aplicación y la categoría de cada uno.",
    itemsEmpty: "Todavía no hay asuntos",
    itemsLoadFailed: "Los asuntos no están disponibles ahora",
    followPrimary: "Seguir la principal",
    manage: "Gestionar categorías",
    manageAction: "Gestionar categorías",
    manageHint: "Crea, renombra, recolorea y elimina aquí. Las categorías integradas también se pueden eliminar — salvo «Otros»; las eliminadas se restauran abajo, y sus aplicaciones pasan a «Otros».",
    deletedHint: "Eliminadas: pulsa para restaurar:",
    usageCount: (count) => `${count} en uso`,
    createColorHint: "Si no eliges color, la paleta lo asigna sola (lo que ves es una vista previa, no tu elección)",
    loadFailed: "No se pudo leer la configuración de esta aplicación",
    saveFailed: "No se pudo guardar, inténtalo de nuevo",
  },
};
