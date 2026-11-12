import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 快捷分类弹层「分类增删」新增的两句话（四语言齐备，[本轮]）。
 *
 * 为什么不进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的**位置数组**，
 * 手插一行会让其后全部文案错位（`generated/contract.ts` 还被 size 门禁冻着）。
 * 为什么不复用 `UI_TEXT.mapping.deleteCategoryDetail`：那句只说"将删除 X 分类"，
 * 没说清**分类里的应用去哪了** —— 而「应用会回到「其他」」正是用户点确认前必须知道的事
 * （`other` 是回落目标，内置分类不可删）。其余文案（新建分类 / 删除分类标题 / 取消 / 确认）
 * 都有现成键，直接复用，不在这里重写。
 */
export interface CategoryAdminCopy {
  /** 新建时输入的名字与已有分类重名（归一后比较）：不提交，并且要**说一句** ——
   *  静默不提交会被当成"点了没反应"。 */
  duplicateName: string;
  /** 删除确认里的第二句：分类删掉之后，里面的应用去哪儿 */
  deleteFallback: string;
}

export const CATEGORY_ADMIN_COPY: Record<Locale, CategoryAdminCopy> = {
  "zh-CN": {
    duplicateName: "已经有同名分类了",
    deleteFallback: "该分类下的应用会回到「其他」。",
  },
  "en-US": {
    duplicateName: "A category with that name already exists",
    deleteFallback: "Apps in this category will fall back to “Other”.",
  },
  "ru-RU": {
    duplicateName: "Категория с таким названием уже есть",
    deleteFallback: "Приложения из этой категории перейдут в «Прочее».",
  },
  es: {
    duplicateName: "Ya existe una categoría con ese nombre",
    deleteFallback: "Las aplicaciones de esta categoría pasarán a «Otros».",
  },
};
