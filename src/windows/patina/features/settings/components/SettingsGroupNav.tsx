/**
 * 设置页的五组锚点导航（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 横排五组，点一下滚到对应卡片（`scrollIntoView({ block: 'start' })`，偏移由
 * `settings-handles.css` 的 `scroll-margin-top` 给，卡片标题不会贴着滚动区顶边）。
 *
 * `aria-current` 由**滚动位置派生**，不引第三方：监听滚动容器（`#settings-scroll`）的
 * `scroll`，用 `requestAnimationFrame` 节流（一次滚动最多一次 setState），取「顶端已越过
 * 视口上沿 -56px」的最后一个锚点作为当前组。不用 `IntersectionObserver` 的理由：五组高度
 * 差很大（G1 三张卡 vs G3 一张卡），交叉比在「谁算当前」上比位置比较更容易跳。
 *
 * 没有「滚动中不许点击」的状态锁：点了就跳，滚动过程中高亮会跟着变，这正是用户想看的反馈。
 */
import { useEffect, useRef, useState } from "react";
import { SETTINGS_GROUPS } from "../settingsGroups";

const SCROLL_CONTAINER_ID = "settings-scroll";
/** 判定线：视口顶端往下 56px（页头高度的经验值，与 `scroll-margin-top: 60px` 配套）。 */
const ACTIVE_OFFSET = 56;

export default function SettingsGroupNav() {
  const [activeGroup, setActiveGroup] = useState(SETTINGS_GROUPS[0]?.id ?? "");
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    const compute = () => {
      frame.current = null;
      const top = container.getBoundingClientRect().top + ACTIVE_OFFSET;
      let current = SETTINGS_GROUPS[0]?.id ?? "";
      for (const group of SETTINGS_GROUPS) {
        for (const anchor of group.anchors) {
          const node = document.getElementById(anchor.id);
          if (!node) continue;
          if (node.getBoundingClientRect().top <= top) current = group.id;
        }
      }
      setActiveGroup((prev) => (prev === current ? prev : current));
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
