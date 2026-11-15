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
  /** 「不绑定」下方的禁用说明行（R6-B）：点「不绑定」只解除当前事项，其他绑定不受影响 */
  unbindOnlyHint: string;
  /** 事项清单读取失败时那一栏的降级文案 */
  itemsLoadFailed: string;
  /** 事项清单为空（用户还没建过事项） */
  itemsEmpty: string;
  /** 写绑定失败 */
  saveFailed: string;
  /* ── [0.13 fix] 「编辑事项」弹层里的「绑定应用」一栏（事项视角，与上面的应用视角互补）──
   * 用户报的 bug（「我启动了燕云，但没开始计时」）根因之一是**根本找不到绑定入口**：
   * 应用视角的入口藏在应用排行卡的双击菜单里，事项视角这条腿是缺的。 */
  /** 一栏的标题：「绑定应用」 */
  boundAppsTitle: string;
  /** 标题下的一句说明：说清「绑了会发生什么」（自动开始计时） */
  boundAppsHint: string;
  /** 已绑定清单为空时的陈述句 */
  boundAppsEmpty: string;
  /** 下拉的占位/无操作项：「选择一个应用」 */
  pickApp: string;
  /** 已绑定行的解绑键 */
  unbindApp: string;
  /** 应用目录读不到时的降级文案 */
  appsLoadFailed: string;
  /** 应用目录里没有可选应用（还没被采集到） */
  appsEmpty: string;
  /** 候选行上的提示：这个应用当前绑在**别的事项**上，选它等于挪过来（1:1 键空间） */
  boundElsewhere: (name: string) => string;
}

export const APP_BINDING_COPY: Record<Locale, AppBindingCopy> = {
  "zh-CN": {
    editApp: (name) => `编辑应用「${name}」`,
    boundTo: (name) => `已绑定：${name}`,
    rowLabelJoiner: "，",
    bindItem: "绑定事项",
    noBinding: "不绑定",
    itemMenuLabel: "选择一个事项",
    unbindOnlyHint: "仅解除当前事项的绑定；应用绑定的其他事项不受影响",
    itemsLoadFailed: "暂时读不到事项",
    itemsEmpty: "还没有事项",
    saveFailed: "保存失败，请重试",
    boundAppsTitle: "绑定应用",
    boundAppsHint: "这些应用切到前台时会自动开始计这件事。",
    boundAppsEmpty: "还没有绑定应用",
    pickApp: "选择一个应用",
    unbindApp: "解绑",
    appsLoadFailed: "暂时读不到应用清单",
    appsEmpty: "还没有可绑定的应用",
    boundElsewhere: (name) => `已绑在「${name}」`,
  },
  "en-US": {
    editApp: (name) => `Edit ${name}`,
    boundTo: (name) => `Bound to: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Bind an item",
    noBinding: "No binding",
    itemMenuLabel: "Choose an item",
    unbindOnlyHint: "Only unbinds the current item; other items bound to this app are unaffected.",
    itemsLoadFailed: "Items are unavailable right now",
    itemsEmpty: "No items yet",
    saveFailed: "Could not save, try again",
    boundAppsTitle: "Bound apps",
    boundAppsHint: "Timing starts this item automatically when one of these apps comes to the front.",
    boundAppsEmpty: "No apps bound yet",
    pickApp: "Pick an app",
    unbindApp: "Unbind",
    appsLoadFailed: "Apps are unavailable right now",
    appsEmpty: "No apps to bind yet",
    boundElsewhere: (name) => `Bound to ${name}`,
  },
  "ru-RU": {
    editApp: (name) => `Изменить «${name}»`,
    boundTo: (name) => `Связано с: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Связать с делом",
    noBinding: "Без связи",
    itemMenuLabel: "Выберите дело",
    unbindOnlyHint: "Отвязывает только текущее дело; другие дела этого приложения не затрагиваются.",
    itemsLoadFailed: "Дела сейчас недоступны",
    itemsEmpty: "Дел пока нет",
    saveFailed: "Не удалось сохранить, повторите",
    boundAppsTitle: "Связанные приложения",
    boundAppsHint: "Timing запустит это дело, когда одно из этих приложений выйдет на передний план.",
    boundAppsEmpty: "Связанных приложений пока нет",
    pickApp: "Выберите приложение",
    unbindApp: "Отвязать",
    appsLoadFailed: "Список приложений сейчас недоступен",
    appsEmpty: "Пока нет приложений для связи",
    boundElsewhere: (name) => `Связано с «${name}»`,
  },
  es: {
    editApp: (name) => `Editar ${name}`,
    boundTo: (name) => `Vinculado a: ${name}`,
    rowLabelJoiner: ", ",
    bindItem: "Vincular un asunto",
    noBinding: "Sin vínculo",
    itemMenuLabel: "Elige un asunto",
    unbindOnlyHint: "Solo desvincula el asunto actual; los demás asuntos de esta aplicación no se ven afectados.",
    itemsLoadFailed: "Los asuntos no están disponibles ahora",
    itemsEmpty: "Aún no hay asuntos",
    saveFailed: "No se pudo guardar, inténtalo de nuevo",
    boundAppsTitle: "Aplicaciones vinculadas",
    boundAppsHint: "Timing inicia este asunto automáticamente cuando una de estas aplicaciones pasa al frente.",
    boundAppsEmpty: "Aún no hay aplicaciones vinculadas",
    pickApp: "Elige una aplicación",
    unbindApp: "Desvincular",
    appsLoadFailed: "Las aplicaciones no están disponibles ahora",
    appsEmpty: "Aún no hay aplicaciones para vincular",
    boundElsewhere: (name) => `Vinculada a ${name}`,
  },
};
