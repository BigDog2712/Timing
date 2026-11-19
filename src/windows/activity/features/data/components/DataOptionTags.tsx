import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { isAnonymousActivity } from "../../../shared/classification/anonymousActivity.ts";

/**
 * 应用趋势行名右侧的**标签**（[0.12.4] 取代原来的「未分类」）。
 *
 * 两态：
 *   · 没有标签（含网页行、匿名活动这类根本没有标签通道的行）→ **什么都不画**。
 *     这里曾经写「未打标签」，但它占着行名右侧最值钱的那点宽度，而"没标签"这件事
 *     本身不需要一句提示 —— 双击这一行就能加（行下方的操作提示已经说了）。
 *   · 有标签 → **全部列出来**，写不下就换行（样式见 `features/data-trend-tags.css`）。
 *     之前只露第一个再加 `+N`，结果 `#学习/考…` 被截断、名字也被挤成
 *     `DeepSeek Harne…`；能看全的信息才算信息。
 *
 * 为什么在这里读 `AppClassification.getAppTags` 而不是让上游把 `tags` 塞进 option：
 * 趋势面板的选项类型是三种目的地共用的（应用 / 标签 / 网页），塞一个只有应用填得上的
 * 字段，另外两路就多背一个永远不用的属性；而"这一行的标签"本来只有这个组件消费。
 * 读的是模块级分类状态，`mappingVersion` 一变上游就重渲染，不会停在旧值。
 *
 * 只画不交互：点这一下要么是选中、要么是双击进编辑，chip 不该抢走这两个手势。
 */
interface Props {
  exeName?: string;
}

export default function DataOptionTags({ exeName }: Props) {
  if (!exeName || isAnonymousActivity(exeName)) return null;
  const tags = AppClassification.getAppTags(exeName);
  if (tags.length === 0) return null;
  return (
    <span className="data-app-option-tags" title={tags.map((tag) => `#${tag}`).join(" ")}>
      {tags.map((tag) => <span key={tag} className="data-app-option-tag">#{tag}</span>)}
    </span>
  );
}
