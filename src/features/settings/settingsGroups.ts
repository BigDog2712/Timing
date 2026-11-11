/**
 * 设置页的分组锚点表（[0.12.1] T04）
 * -----------------------------------------------------------------------------
 * 只登记**真实存在**的锚点：写一条指向不存在的 `id`，点上去既不滚也不报错，是那种
 * 「用户以为界面坏了、开发以为导航坏了」的空指针。每加一张卡才加一行。
 *
 * 顺序 = 页面上的分组顺序 = 卡片在网格里的顺序。**「悬浮条与手柄」必须是第一组**：
 * 它是本轮的主功能，用户进设置页第一眼要能看到手柄绑定（PRD A-01 的可发现性）。
 *
 * `title` / `anchors[].title` 是中文常量，**不进 i18n**：`src/shared/i18n/generated/contract.ts`
 * 本轮零行余量（设计 §9.1-R1），加 key 会把冻结行数顶破。
 */
export interface SettingsAnchor {
  /** DOM id（页面上那张卡的 `id`），锚点导航按它 `scrollIntoView` */
  id: string;
  title: string;
}

export interface SettingsGroup {
  /** 分组键（不渲染，用于 `aria-current`） */
  id: string;
  title: string;
  anchors: readonly SettingsAnchor[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "pill",
    title: "悬浮条与手柄",
    anchors: [
      { id: "s-pill-handles", title: "手柄绑定" },
      { id: "s-pill-look", title: "悬浮条外观" },
    ],
  },
  {
    id: "appearance",
    title: "外观与配色",
    anchors: [
      { id: "s-theme", title: "主题与主色" },
      { id: "s-highlight", title: "高亮颜色" },
      { id: "s-display", title: "显示与语言" },
    ],
  },
  {
    id: "tracking",
    title: "计时与记录",
    anchors: [
      { id: "s-tracking", title: "记录规则" },
      { id: "s-interface", title: "接口" },
    ],
  },
  {
    id: "data",
    title: "数据与同步",
    anchors: [
      { id: "s-sync", title: "同步与备份" },
      { id: "s-backup", title: "数据安全" },
    ],
  },
  {
    id: "general",
    title: "通用与启动",
    anchors: [
      { id: "s-general", title: "通用" },
      { id: "s-resident", title: "常驻与启动" },
      { id: "s-plugins", title: "插件" },
    ],
  },
];

/** 全部锚点 id（设置页插卡片时按它写 `id`，拼错会被 `settingsGroups.test` 抓到）。 */
export const SETTINGS_ANCHOR_IDS: readonly string[] =
  SETTINGS_GROUPS.flatMap((group) => group.anchors.map((anchor) => anchor.id));
