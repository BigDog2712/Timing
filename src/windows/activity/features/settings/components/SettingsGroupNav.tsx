/**
 * 设置页的分组锚点导航（[0.12.1] T04b，[本轮] 修「点一组亮另一组」）
 * -----------------------------------------------------------------------------
 * 横排六组，点一下滚到对应卡片。跳转**自己算 `scrollTop`**，偏移与判定线共用
 * `settings-handles.css` 的 `scroll-margin-top`（`readActiveOffset()` 从 CSS 读，不手抄）。
 *
 * `aria-current` 由**滚动位置派生**：监听滚动容器（`#settings-scroll`）的 `scroll`，
 * 用 `requestAnimationFrame` 节流（一次滚动最多一次 setState）。不用
 * `IntersectionObserver` 的理由：各组高度差很大（G1 三张卡 vs G3 一张卡），交叉比在
 * 「谁算当前」上比位置比较更容易跳。
 *
 * ## 判定算法
 *
 * 与遍历顺序**无关**：在所有"已越过判定线"的锚点里取 `top` 最大的那个（= DOM 位置
 * 最靠下），它所属的组就是当前组。锚点嵌套（`s-interface` 长在 `s-display` 卡里）、
 * 表顺序错位都不会再影响结果（旧实现按表顺序取"最后一个越线"，会被 `s-interface` 串组）。
 * 到底边界单独一条规则：容器还有可滚空间且已滚到底 → 直接取表里最后一组。
 * `scrollHeight > clientHeight` 这个前置条件是必须的：内容一屏放得下时
 * `0 + clientHeight >= scrollHeight - 2` 恒成立，不设防的话一进设置页就停在最后一组。
 *
 * ## [本轮] 两个真缺陷：落点压线 + 点击后高亮被抢走
 *
 * ① **落点恰好压线 → 差 0.4px 就判成"未越线"**。判定线 = `容器top + 18`，跳转落点也是
 *    18（两边同一个数、零容差），偏差只来自设备像素取整：Windows 缩放 125%/150% 下
 *    `getBoundingClientRect()` 返回小数，而 `scrollTop` 按设备像素取整，落点会偏
 *    ±0.x px。偏正的那一半（`top = 判定线 + 0.4`）被 `top > 判定线` 判成"还没到"排除掉，
 *    循环回落到上一个已越线锚点 —— 于是**相邻两组互相顶替、完全对称**，正是用户报的那个
 *    形状（点 A 亮 B、点 B 亮 A，两组都在对方面前"差 0.4px"）。
 *    修法 = `LINE_TOLERANCE`：`top <= 判定线 + 2` 即视为已越线。**不是随手加的魔数**，
 *    2px 的量级来自两件事：① 设备像素取整的误差上限 < 1px（125%/150% 缩放各 0.8/0.5px）；
 *    ② 相邻两个锚点的间距至少几十 px，2px 不会把"下一张卡"误判成已越线。
 *
 * ② **「点击即钉住」的语义必须是「位置」，不能是「帧数」**。点击那一刻已经
 *    `setActiveGroup(目标组)`（用户在等的是这个反馈），接着 `jump()` 自己写 `scrollTop`；
 *    滚动是瞬时的（设置页没有 `scroll-behavior: smooth`），落定后浏览器只补发**一个**
 *    `scroll` 事件。所以钉子 = `pinnedLanding`：`scrollTop` 停在落点 ± `BOTTOM_TOLERANCE`
 *    内 → 保持用户点的组，**完全不派生**（几何与到底规则都让位）；一旦离开落点 → 立刻
 *    解钉、交回几何派生。两种偏离过落点的姿势都因此正确：
 *      · 用户按一次 `Home` / `End`、或把滚动条拖到位（**只发一个** scroll 事件）→ 位置
 *        立刻对上/立刻离开，一步到位；
 *      · 用户停在落点上轻轻晃（连发十几个 scroll）→ 位置一直在容差内，钉子一直在。
 *
 *    上一版是 `pin = { landing, frames }` 按 `scroll` 事件数递减的兜底，配上
 *    `suppressBottomAt` 另记一笔"落点附近"—— 两个状态、两套语义，而且**两处都记了未夹的
 *    落点**（见 ③），于是：一次 `Home` 只扣 1 帧，钉子还在 → 高亮停在上一组的名字上；
 *    抖满 13 帧耗光钉子 → `suppressBottomAt` 早已被判"离开落点"清掉 → 到底规则接管 → 改判末组。
 *
 * ③ **落点先夹再记**。`scrollTop` 写下去会被浏览器夹到 `[0, scrollHeight - clientHeight]`：
 *    页尾那几个锚点（`s-sync` / `s-general`）算出来的落点在 800–1000，而容器的可滚量只有
 *    几百 px，实际停在底部。若把**未夹**的原值记进 `pinnedLanding`，解钉条件
 *    `|scrollTop - landing| <= 2` 就**永不成立**（982 vs 500），钉子只能靠时间/帧数猜。
 *    所以写 `scrollTop` 与记 `pinnedLanding` 用**同一个夹过的值**，解钉条件与实际位置同源。
 *
 * ## 有意的取舍（不是漏洞）
 *
 * 「滚不到判定线」的那几组（`s-sync` / `s-general` / 页尾任何一组）点下去，落点被夹在
 * 底部，几何派生会得到相邻的组、到底规则会得到末组。用户停下时看到的是**自己点的那组**，
 * 这是刻意的：点了什么就亮什么。一旦他滚动离开落点（哪怕 3px），高亮立刻按几何走，
 * 可能当场变成相邻组 —— **点击给一次确定性反馈，滚动之后以位置为准**。
 * 不这么做的代价是要猜"用户是想停在这儿还是还在滚"，上一版就是猜错的。
 *
 * ## [复核修复] 两处点修：一屏装得下时不设钉、锚点节点缺失时的"亮但不滚"
 *
 * ① **一屏装得下（`maxScroll === 0`）时不设钉，但点击照样点亮**。钉子
 *    （`pinnedLanding`）靠「`scrollTop` 离开落点」解开，而 `maxScroll === 0` 时
 *    `scrollTop` 恒为 0、此后**永远不会再有 `scroll` 事件** —— 钉子一旦设上就再也
 *    解不开，高亮永久停在用户点的那一组，此后没有任何事件能纠正（QA 报的形状）。
 *    修法：这条路上 `setActiveGroup(目标组)` **照旧**（"点了就亮"是用户唯一能拿到的
 *    确定性反馈），但**不写 `scrollTop`、不设钉** —— 没有钉子就没有"解不开"这回事。
 *    曾经试过在这条路上改成"按几何派生一次、不看点击"，代价是点击完全没有反应：
 *    几何结果恒为"这一屏顶部越线的那一组"，点「通用与启动」界面毫无变化。这条路径
 *    在真实数据下几乎不出现（13 个锚点、内容远高于视口），不值得为它把点击语义翻面。
 *
 * ② **锚点节点缺失时整条 `return`，且必须在 `setActiveGroup` 之前**。曾经是先
 *    `setActiveGroup(groupId)` 再去取容器与节点，节点不存在（卡片被裁掉 / id 打错）时
 *    直接 `return` —— 于是高亮跳了、页面没动、也没钉子，用户看到的是"点了一下，亮到
 *    别处去了"。这种点击**什么也不该发生**：不改高亮、不写 `scrollTop`、不设钉。
 *
 * ## 为什么不用 `scrollIntoView`
 *
 * 它会把**所有可滚祖先**一起滚（设置页外面还有页面级滚动区），落点由浏览器说了算、
 * 与 `scroll-margin-top` 的交互在不同引擎上还不一致。显式算 `scrollTop` 之后落点是本组件
 * 自己写下去的数，判定线与落点天然同源，误差只剩设备像素取整那一档（即上面 ① 的容差）。
 */
import { useEffect, useRef, useState } from "react";
import { SETTINGS_GROUPS } from "../settingsGroups";

const SCROLL_CONTAINER_ID = "settings-scroll";
/** CSS 读不到时的兜底（如无头环境）；正常路径永远走 `scroll-margin-top`。 */
const FALLBACK_ACTIVE_OFFSET = 18;
/**
 * 「位置容差」（px），**一处常量三处用** —— 调它会同时挪动下面三者，不是只动一处：
 * ① `canScroll` 的前置条件（`scrollHeight > clientHeight + 本值`）：内容"几乎刚好一屏"
 *    时到底规则不该生效，差 2px 以内算装得下；
 * ② 到底判定（`scrollTop + clientHeight >= scrollHeight - 本值`）—— 亚像素滚动位置在
 *    不同 DPI 下会差 1–2px；
 * ③ 「还停在落点上」的解钉判据（`|scrollTop - pinnedLanding| <= 本值`）—— 落点由本组件
 *    写下去，回读的 `scrollTop` 会被设备像素取整。
 * 三者的误差源头是同一个（设备像素取整），所以共用一个数；也正因为共用，
 * 把它从 2 改成 3 会**同时**挪动到底阈值（pe07 红）与解钉阈值（pe03 红）。
 */
const BOTTOM_TOLERANCE = 2;
/** 「落点压线」的容差（px）：见文件头 ①，设备像素取整误差上限 < 1px。 */
const LINE_TOLERANCE = 2;

/**
 * 判定线与跳转落点的偏移从 CSS 读，不手抄第二个常量：锚点的 `scroll-margin-top`
 * 定义在 `settings-handles.css`（页头删除后 60 → 18）。读不到（NaN）时回落到旧经验值。
 */
function readActiveOffset(): number {
  const anchor = document.querySelector<HTMLElement>("#settings-scroll [id^='s-']");
  if (!anchor) return FALLBACK_ACTIVE_OFFSET;
  const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop);
  return Number.isFinite(margin) ? margin : FALLBACK_ACTIVE_OFFSET;
}

/**
 * 按**几何**派生"此刻应该是哪一组"（不含钉子，钉子只属于滚动监听那一侧）。
 *
 * 只有 `compute()` 一个调用点（每次滚动、rAF 节流之后跑一次）。之所以独立成函数而不是
 * 内联，是因为几何判据必须只有一份：到底规则、越线容差、嵌套锚点全在这里 —— 抄第二份
 * 会在某条冷路上悄悄分叉（到底规则忘加 `canScroll` 正是上一版的那个形状：一进设置页就
 * 停在末组）。
 *
 * 它是**模块私有**的（未 `export`）：将来真要在别处复用，得先把它导出、并补上纯函数单测
 * （`canScroll=false` 恒不返回末组 / `LINE_TOLERANCE` 边界 / 缺锚点回落 `SETTINGS_GROUPS[0]`）
 * 再调它 —— 现在直接调是调不到的，别照着老注释去 `import`。
 */
function readActiveGroupId(container: HTMLElement, scrollTopNow: number): string {
  const line = container.getBoundingClientRect().top + readActiveOffset();
  const lastGroup = SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1];

  /* 到底边界：只在"确实还能滚"的前提下生效（见文件头为什么必须加这个前置条件） */
  const canScroll = container.scrollHeight > container.clientHeight + BOTTOM_TOLERANCE;
  if (
    lastGroup
    && canScroll
    && scrollTopNow + container.clientHeight >= container.scrollHeight - BOTTOM_TOLERANCE
  ) {
    return lastGroup.id;
  }

  /* 已越过判定线的锚点里挑 top 最大（DOM 最靠下）的那个 —— 与遍历顺序无关 */
  let currentId = SETTINGS_GROUPS[0]?.id ?? "";
  let currentTop = Number.NEGATIVE_INFINITY;
  for (const group of SETTINGS_GROUPS) {
    for (const anchor of group.anchors) {
      const node = document.getElementById(anchor.id);
      if (!node) continue;
      const { top } = node.getBoundingClientRect();
      if (top > line + LINE_TOLERANCE || top <= currentTop) continue;
      currentTop = top;
      currentId = group.id;
    }
  }
  return currentId;
}

export default function SettingsGroupNav() {
  const [activeGroup, setActiveGroup] = useState(SETTINGS_GROUPS[0]?.id ?? "");
  const frame = useRef<number | null>(null);
  /**
   * 点击写下的落点（**已经夹进可滚范围**，见文件头 ③）；`null` = 没有钉住。
   * 语义见文件头 ②：`scrollTop` 还在它附近 → 保持用户点的组；离开 → 交回几何。
   */
  const pinnedLanding = useRef<number | null>(null);

  useEffect(() => {
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    const compute = () => {
      frame.current = null;
      const scrollTopNow = container.scrollTop;

      /* ① 钉住期：还停在落点上 → 用户点了什么就亮什么，几何与到底规则都让位 */
      const pinned = pinnedLanding.current;
      if (pinned !== null) {
        if (Math.abs(scrollTopNow - pinned) <= BOTTOM_TOLERANCE) return;
        /* 离开落点 → 立刻解钉，交回几何（不设帧数/时间兜底：位置本身就说清了一切） */
        pinnedLanding.current = null;
      }

      const currentId = readActiveGroupId(container, scrollTopNow);
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

  /** 跳到某个组的某个锚点，并**立刻**把该组点亮、钉住到离开落点为止（见文件头 ②③） */
  const jump = (groupId: string, anchorId: string) => {
    if (!SETTINGS_GROUPS.some((item) => item.id === groupId)) return;

    /* **先取节点、再动高亮**（见文件头 [复核修复] ②）：锚点节点不存在时这次点击
       什么也不该发生 —— 不改高亮、不写 `scrollTop`、不设钉。先 `setActiveGroup` 再检查
       节点的旧顺序会让"分组存在但卡片没渲染"变成"亮了、页面没动"。 */
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    const node = document.getElementById(anchorId);
    if (!container || !node) return;

    /* 可滚量：落点要被夹进它；`maxScroll === 0` 还决定要不要设钉 */
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);

    /* **点击即亮**：用户在等这个反馈。放在可滚空间判断之前，两条路径共用同一句 ——
       一屏装得下时也要亮（见文件头 [复核修复] ①）。 */
    setActiveGroup((prev) => (prev === groupId ? prev : groupId));

    if (maxScroll === 0) {
      /* 一屏装得下（见文件头 [复核修复] ①）：没有可滚空间（`scrollTop` 写下去也是 0），
         此后也不会再有 `scroll` 事件 —— 设钉等于永久钉死，再没有任何事件能纠正它。
         所以到此为止：**不写 `scrollTop`、不设钉**，只保留上面那一下点亮。 */
      return;
    }
    /* 落点 = 目标锚点的文档位置 − 判定线偏移。显式算，不走 `scrollIntoView`（见文件头） */
    const raw = container.scrollTop + node.getBoundingClientRect().top
      - container.getBoundingClientRect().top - readActiveOffset();
    /* **先夹再记**：写 `scrollTop` 与记 `pinnedLanding` 必须是同一个值。记未夹的原值
       （页尾锚点 982 vs 实际能到的 500）会让解钉条件 `|scrollTop - landing| <= 2` 永不成立，
       钉子只能靠帧数/时间猜 —— 上一版就是这么把高亮卡在上一组、又被到底规则改判的。 */
    const landing = Math.max(0, Math.min(raw, maxScroll));
    container.scrollTop = landing;
    pinnedLanding.current = landing;
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
              onClick={() => jump(group.id, group.anchors[0]?.id ?? "")}
            >
              {group.title}
            </button>
            <div className="settings-group-nav__anchors">
              {group.anchors.map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  className="settings-group-nav__anchor"
                  onClick={() => jump(group.id, anchor.id)}
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
