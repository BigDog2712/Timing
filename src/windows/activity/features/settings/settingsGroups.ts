/**
 * 设置页的分组锚点表（[0.12.1] T04 · [B5b] 按使用场景五组重排）
 * -----------------------------------------------------------------------------
 * 只登记**真实存在**的锚点：写一条指向不存在的 `id`，点上去既不滚也不报错，是那种
 * 「用户以为界面坏了、开发以为导航坏了」的空指针。每加一张卡才加一行。
 *
 * 顺序 = 页面上的分组顺序 = 卡片在网格里的顺序，口径是**按使用场景分组、高频组进第一屏**：
 * 计时行为 → 外观与主题 → 悬浮条与把手 → 数据与同步 → 通用与启动。
 *
 * 「第一组必须是悬浮条与手柄」那条**已经作废**（0.12.1 给把手绑定这个新功能配的
 * 可发现性口径，PRD A-01）。新功能期一过，把手绑定属于「设置一次就不再动」的高级项，
 * 长期占着第一屏只是在挤计时规则 —— 计时规则才是每次调时长都要改的高频项。把手绑定的
 * 可发现性改由三件事兜：仍在同一页、导航仍是一步直达（组内第一张卡）、B5c 的折叠区与
 * 一次性引导。**别照着旧注释把它挪回第一组。**
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
    id: "tracking",
    title: "计时行为",
    anchors: [
      { id: "s-tracking", title: "记录规则" },
    ],
  },
  {
    id: "appearance",
    title: "外观与主题",
    anchors: [
      { id: "s-theme", title: "主题与主色" },
      { id: "s-highlight", title: "高亮颜色" },
      { id: "s-display", title: "显示与语言" },
    ],
  },
  {
    id: "pill",
    title: "悬浮条与把手",
    anchors: [
      { id: "s-pill-handles", title: "把手绑定" },
      { id: "s-pill-look", title: "悬浮条外观" },
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
      { id: "s-ai", title: "AI 与标签" },
    ],
  },
];

/** 全部锚点 id（设置页插卡片时按它写 `id`，拼错会被 `settingsGroups.test` 抓到）。 */
export const SETTINGS_ANCHOR_IDS: readonly string[] =
  SETTINGS_GROUPS.flatMap((group) => group.anchors.map((anchor) => anchor.id));
