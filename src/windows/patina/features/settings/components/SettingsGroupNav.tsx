/**
 * 设置页的五组锚点导航（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 横排五组，点一下滚到对应卡片（`scrollIntoView({ block: 'start' })`，偏移由
 * `settings-handles.css` 的 `scroll-margin-top` 给，卡片标题不会贴着滚动区顶边）。
 *
 * `aria-current` 由**滚动位置派生**，不引第三方：监听滚动容器（`#settings-scroll`）的
 * `scroll`，用 `requestAnimationFrame` 节流（一次滚动最多一次 setState）。不用
 * `IntersectionObserver` 的理由：五组高度差很大（G1 三张卡 vs G3 一张卡），交叉比在
 * 「谁算当前」上比位置比较更容易跳。
 *
 * ## 判定算法（[本轮] 修两处真缺陷）
 *
 * 旧实现按 `SETTINGS_GROUPS` 的**表顺序**遍历全部锚点，取"最后一个越过判定线的锚点所属组"。
 * 它有两个必然失效的场景，都不是样式问题：
 *
 *   ① **锚点嵌套 + 表顺序错位 → 串组**：`s-interface` 在 DOM 里嵌在 `s-display` 卡片内部
 *      （`Settings.tsx`），位置上**早于** `s-board-widgets`，但在表里登记在 `tracking` 组、
 *      排在 `s-board-widgets` 之后。于是滚到「主界面」区间时，循环最后走到 `s-interface`，
 *      `current` 被覆盖成 `tracking` ——「主界面」永远不亮。
 *   ② **滚到底 → 最后一组永不满足**：容器到底后 `s-general` / `s-resident` / `s-plugins` 的
 *      `top` 再也不可能被推到判定线以上，`current` 停在前一组，「通用与启动」不亮。
 *
 * 新实现与遍历顺序**无关**：在所有"已越过判定线"的锚点里取 `top` 最大的那个（= DOM 位置
 * 最靠下），它所属的组就是当前组。锚点嵌套、表顺序错位都不会再影响结果。
 * 到底边界单独一条规则：容器还有可滚空间且已滚到底（`scrollTop + clientHeight >=
 * scrollHeight - 2`）→ 直接取表里最后一组。`scrollHeight > clientHeight` 这个前置条件是
 * 必须的：内容一屏放得下时 `0 + clientHeight >= scrollHeight - 2` 恒成立，不设防的话
 * 一进设置页就会停在最后一组。
 *
 * 没有「滚动中不许点击」的状态锁：点了就跳，滚动过程中高亮会跟着变，这正是用户想看的反馈。
 */
import { useEffect, useRef, useState } from "react";
import { SETTINGS_GROUPS } from "../settingsGroups";

const SCROLL_CONTAINER_ID = "settings-scroll";
/** CSS 读不到时的兜底（如无头环境）；正常路径永远走 `scroll-margin-top`。 */
const FALLBACK_ACTIVE_OFFSET = 18;
/** 到底判定的容差（px）：亚像素滚动位置在不同 DPI 下会差 1–2px。 */
const BOTTOM_TOLERANCE = 2;

/**
 * [本轮 T05] 判定线从 CSS 读，不再手抄第二个常量：锚点的 `scroll-margin-top`
 * 定义在 `settings-handles.css`（页头删除后 60 → 18），跳转的落点与高亮的判定线
 * 必须是**同一个数**。读不到（NaN）时回落到旧经验值。
 */
function readActiveOffset(): number {
  const anchor = document.querySelector<HTMLElement>("#settings-scroll [id^='s-']");
  if (!anchor) return FALLBACK_ACTIVE_OFFSET;
  const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop);
  return Number.isFinite(margin) ? margin : FALLBACK_ACTIVE_OFFSET;
}

export default function SettingsGroupNav() {
  const [activeGroup, setActiveGroup] = useState(SETTINGS_GROUPS[0]?.id ?? "");
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    const compute = () => {
      frame.current = null;
      const lastGroup = SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1];

      /* 到底边界：只在"确实还能滚"的前提下生效（见文件头注释为什么必须加这个前置条件） */
      const canScroll = container.scrollHeight > container.clientHeight + BOTTOM_TOLERANCE;
      if (
        lastGroup
        && canScroll
        && container.scrollTop + container.clientHeight >= container.scrollHeight - BOTTOM_TOLERANCE
      ) {
        const bottomGroupId = lastGroup.id;
        setActiveGroup((prev) => (prev === bottomGroupId ? prev : bottomGroupId));
        return;
      }

      const line = container.getBoundingClientRect().top + readActiveOffset();
      /* 已越过判定线的锚点里挑 top 最大（DOM 最靠下）的那个 —— 与遍历顺序无关 */
      let currentId = SETTINGS_GROUPS[0]?.id ?? "";
      let currentTop = Number.NEGATIVE_INFINITY;
      for (const group of SETTINGS_GROUPS) {
        for (const anchor of group.anchors) {
          const node = document.getElementById(anchor.id);
          if (!node) continue;
          const { top } = node.getBoundingClientRect();
          if (top > line || top <= currentTop) continue;
          currentTop = top;
          currentId = group.id;
        }
      }
      setActiveGroup((prev) => (prev === currentId ? prev : currentId));
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(compute);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  const jump = (anchorId: string) => {
    const node = document.getElementById(anchorId);
    if (!node) return;
    node.scrollIntoView({ block: "start" });
  };

  return (
    <nav className="settings-group-nav" aria-label="设置分组">
      {SETTINGS_GROUPS.map((group) => {
        const on = group.id === activeGroup;
        return (
          <div key={group.id} className="settings-group-nav__group">
            <button
              type="button"
              className="settings-group-nav__title"
              aria-current={on ? "true" : undefined}
              onClick={() => jump(group.anchors[0]?.id ?? "")}
            >
              {group.title}
            </button>
            <div className="settings-group-nav__anchors">
              {group.anchors.map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  className="settings-group-nav__anchor"
                  onClick={() => jump(anchor.id)}
                >
                  {anchor.title}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
