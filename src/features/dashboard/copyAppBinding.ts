import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 应用排行卡「双击 → 编辑应用」那一批文案（0.12.1）。
 *
 * 为什么单独成文件，而不是继续往 `copy.ts` 里堆：那张表已经 283 行，
 * 单文件硬上限是 300（`npm run check:size` 是**逐文件棘轮**，不许新增豁免），
 * 再塞 7 个键 × 4 语言就顶穿了。拆出来的口径与那张表**完全一致**：
 * 组件侧 `Record<Locale, …>`、四语言齐全、不进 `src/shared/i18n/**`
 * （那是按索引对齐的位置数组，插一行会整体错位）。
 *
 * 键的分工：`editApp` / `boundTo` 是**行**上的（`AppsModule`）；
 * 其余四键是**弹层**里的（`QuickClassificationSurface` 的「绑定事项」那一栏）。
 * 弹层属分类特性，但文案由调用方注入 —— Data / History 两处调用方不传
 * `itemBinding`，因此拿不到也用不上这些串，行为与现状逐字一致。
 */
export interface AppBindingCopy {
  /** 行按钮的 `aria-label`：说出「这一行按下去会发生什么」 */
  editApp: (name: string) => string;
  /** 行标记的 `title`：「已绑定：<事项名>」 */
  boundTo: (name: string) => string;
  /**
   * 行 `aria-label` 里「编辑应用…」与「已绑定：…」之间的分隔符（0.12.1）。
   * 两段都是完整句子，只用空格会在英文里粘成「Edit VS Code Bound to: X」；
   * 中文用全角逗号，其余三语用「, 」。
   */
  rowLabelJoiner: string;
  /** 弹层菜单项「绑定事项」 */
  bindItem: string;
  /** 事项清单首项「不绑定」（= 清除） */
  noBinding: string;
  /** 事项子菜单的 `aria-label` */
  itemMenuLabel: string;
  /** 事项清单读取失败时那一栏的降级文案 */
  itemsLoadFailed: string;
  /** 事项清单为空（用户还没建过事项） */
  itemsEmpty: string;
  /** 写绑定失败 */
  saveFailed: string;
}

export const APP_BINDING_COPY: Record<Locale, AppBindingCopy> = {
  "zh-CN": {
    editApp: (name) => `编辑应用「${name}」`,
    boundTo: (name) => `已绑定：${name}`,
    rowLabelJoiner: "，",
    bindItem: "绑定事项",
    noBinding: "不绑定",
    itemMenuLabel: "选择一个事项",
    itemsLoadFailed: "暂时读不到事项",
    itemsEmpty: "还没有事项",
    saveFailed: "保存失败，请重试",
  },
  "en-US": {
    editApp: (name) => `Edit ${name}`,
    boundTo: (name) => `Bound to: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Bind an item",
    noBinding: "No binding",
    itemMenuLabel: "Choose an item",
    itemsLoadFailed: "Items are unavailable right now",
    itemsEmpty: "No items yet",
    saveFailed: "Could not save, try again",
  },
  "ru-RU": {
    editApp: (name) => `Изменить «${name}»`,
    boundTo: (name) => `Связано с: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Связать с делом",
    noBinding: "Без связи",
    itemMenuLabel: "Выберите дело",
    itemsLoadFailed: "Дела сейчас недоступны",
    itemsEmpty: "Дел пока нет",
    saveFailed: "Не удалось сохранить, повторите",
  },
  es: {
    editApp: (name) => `Editar ${name}`,
    boundTo: (name) => `Vinculado a: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Vincular un asunto",
    noBinding: "Sin vínculo",
    itemMenuLabel: "Elige un asunto",
    itemsLoadFailed: "Los asuntos no están disponibles ahora",
    itemsEmpty: "Aún no hay asuntos",
    saveFailed: "No se pudo guardar, inténtalo de nuevo",
  },
};
