/**
 * Timing — 主窗「内容自适应尺寸」（P1 修复：透明层空白区吞点击）
 * -----------------------------------------------------------------------------
 * 背景：点击穿透只对 CSS 生效（pointer-events:none），对 **OS 窗口**无效 ——
 * WebView2 窗口矩形的鼠标事件全被它吃掉，桌面 / 别的应用都点不到。
 * 旧方案是「384×360 透明画布 + 把窗口收缩到内容包围盒」；ADR-020 删掉了那张画布。
 *
 * 现状（无画布）：
 *   - html/body/.layer 都按**内容**自适应，没有 384×360 常量；
 *   - 胶囊与浮层（菜单 / 面板 / 撤销条 / 提示 / 倒计时卡）统一按「胶囊左上角为原点」的
 *     布局坐标绝对定位，可直接测到视口外的真实包围盒（fixed 置层不受裁剪影响）；
 *   - 包围盒取 4 条边（left/top/right/bottom），窗口原点也跟着挪：内容在布局坐标里
 *     偏移 (L, T) 时窗口位置同步 +（L, T），**内容在屏幕上的位置一点不动**；
 *   - 上界不再是常量：主窗取胶囊所在显示器的工作区（Rust `main_work_area`），
 *     非主窗取真实视口 —— 见 `lib/fitBounds.ts`。
 *
 * 测量对象是 `.layer` 的直接子节点（App 里都是浮层根：stack / 各菜单 / 各对话框 / 提示条），
 * 用 getBoundingClientRect 的四边取并集——布局坐标即视口坐标（layer 是 fixed）。
 *
 * 本文件只负责「测量 → 交给纯函数裁决 → 落地到 OS 窗口」这条管道；
 * 包围盒算术全部在 `lib/autoFit.ts`，由 `autoFit.test.ts` 覆盖（T15）。
 */

import { useEffect } from 'react';
import { getCurrentWindow, LogicalPosition, LogicalSize } from '../lib/window';
import { isTauri } from '../services/ipc';
import { fitBounds, refreshFitBounds, setLayerOffset } from '../lib/fitBounds';
/* [V0.5.0] 键名统一走 lib/storageKeys.ts：`timing.fit-offset`（老键 `tickbar:fit-offset`
   是冒号，历史形态，只读回落；本次统一为点，见 ARCHITECTURE §6.2 P1-2）。 */
import { readKeyWithLegacy, writeKey } from '../lib/storageKeys';
import {
  DEFAULT_FIT_THRESHOLDS,
  computeFitBox,
  isRendered,
  toLayerRect,
  unionEdges,
  type FitBox,
} from '../lib/autoFit';

/** 轮询间隔：兜底捕获「只改样式不改 DOM」的显隐变化（动画结束、过渡态） */
const POLL_MS = 250;
/**
 * 窗口原点对应的布局坐标。跨会话记住它：
 * window-state 插件会恢复上次的窗口位置与尺寸，二者必须成对恢复，
 * 否则首帧会把内容按旧起点平移一次（最多 16px 的跳位）。
 * [V0.5.0] 键名见 `lib/storageKeys.ts`（不再在本文件写键字面量）。
 */
/** 窗口移动后重取上界的节流间隔（拖动时 `onMoved` 会连发；每次重取是 3 个 IPC） */
const MOVE_REFRESH_MS = 160;

type FitState = FitBox;

function readOffset(): { l: number; t: number } {
  try {
    const raw = readKeyWithLegacy('fitOffset');
    if (!raw) return { l: 0, t: 0 };
    const parsed = JSON.parse(raw) as { l?: unknown; t?: unknown };
    const l = Number(parsed.l);
    const t = Number(parsed.t);
    return { l: Number.isFinite(l) ? l : 0, t: Number.isFinite(t) ? t : 0 };
  } catch {
    return { l: 0, t: 0 };
  }
}

function writeOffset(l: number, t: number): void {
  /* 隐私模式 / 存储满：退化为不记忆，最多首帧跳一次（writeKey 内部吞异常） */
  writeKey('fitOffset', JSON.stringify({ l, t }));
}


export function useWindowAutoFit(): void {
  useEffect(() => {
    if (!isTauri()) return;

    const win = getCurrentWindow();
    const saved = readOffset();
    let fit: FitState = { l: saved.l, t: saved.t, w: 0, h: 0 };
    let disposed = false;
    let inFlight = false;

    /* 置层整体平移 (-l,-t)：窗口左上角从布局原点挪到内容起点，
       内容因此落在窗口 (0,0)，裁掉的正好是四周透明带，屏幕上零位移。
       只挪窗口不挪内容的话，左边/上边的留白会留在窗口外、内容反而被裁掉一截。 */
    const applyOffset = (l: number, t: number) => {
      /* 先把平移量登记给 lib：指针坐标 → 布局坐标（菜单锚点）要用它 */
      setLayerOffset(l, t);
      const layerEl = document.querySelector('.layer');
      if (!(layerEl instanceof HTMLElement)) return;
      layerEl.style.transform = l === 0 && t === 0 ? '' : `translate(${-l}px, ${-t}px)`;
    };
    applyOffset(saved.l, saved.t);

    const measure = () => {
      if (disposed || inFlight) return;
      /* 窗口被托盘隐藏 / 最小化时 WebView 不渲染，rect 全为 0：
         白算一轮不说，还可能把 fit 写成 1×1 再在恢复时抖一下。可见时由
         visibilitychange 补一次测量。 */
      if (document.hidden) return;
      const layer = document.querySelector('.layer');
      if (!layer) return;

      /* 防御：万一视口被程序化滚动（focus/scrollIntoView），rect 是视口坐标，
         加回滚动量才是布局坐标，否则窗口会算错尺寸。 */
      const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      /* 遮罩（menu-scrim / dialog-scrim）永远铺满整个窗口，是背板不是内容，
         自己算进包围盒会把窗口重新撑满屏（实测白占一块桌面）。
         但 dialog-scrim 里装着真正的对话框，所以要下钻一层量它的孩子。
         窗口外的点击本来就不进窗口，点外收起已有 main.tsx 的 blur 兜底。 */
      const candidates: HTMLElement[] = [];
      /* `.layer__stack` 是排版容器：它自己的矩形含 --snap-margin / --pill-inset 的留白，
         直接量它等于把透明带原样留在窗口里（用户看到的「面板下还有占用」就是这条）。
         所以容器一律展开成元素孩子，只量真正画出来的那块。 */
      const pushExpanded = (el: HTMLElement) => {
        if (el.matches('.layer__stack')) {
          const kids = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
          if (kids.length > 0) {
            for (const kid of kids) pushExpanded(kid);
            return;
          }
        }
        candidates.push(el);
      };
      for (const child of Array.from(layer.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.matches('.menu-scrim, .dialog-scrim')) {
          for (const inner of Array.from(child.children)) {
            if (inner instanceof HTMLElement) pushExpanded(inner);
          }
          continue;
        }
        pushExpanded(child);
      }

      /* 只收集「真的画出来了」的矩形，并把视口坐标换算成布局坐标后交给纯函数。
         换算必须带 fit 平移量与滚动量，否则会形成正反馈（缩一次 → 量到更小的 L
         → 再缩 → 内容飞出窗口）。
         不把 box-shadow 外扩算进窗口：留投影会让浮层四周多出一圈「点了没反应」的
         死区，而浮层的收起靠窗口失焦（blur）—— 用户点在菜单边缘外侧的第一下会被
         这圈死区吃掉，菜单关不掉，正是这次要修的毛病。宁可投影被窗口边缘切掉。 */
      const rects = [];
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (!isRendered(style, rect)) continue;
        rects.push(toLayerRect(rect, fit, { x: scrollX, y: scrollY }));
      }

      // 上界是上限：主窗 = 胶囊所在显示器工作区，内容再大也不撑出屏幕（ADR-020）
      const decision = computeFitBox(
        unionEdges(rects),
        fitBounds(),
        fit,
        DEFAULT_FIT_THRESHOLDS,
      );
      if (!decision) return;
      const { box, sizeChanged, posChanged, dx, dy } = decision;

      const prev = fit;
      fit = box;
      writeOffset(box.l, box.t);
      inFlight = true;
      void (async () => {
        try {
          /* 先挪内容与窗口，再裁尺寸：置层平移和窗口平移同步发生，
             屏幕上内容不动；随后 setSize 只是切掉右侧/下方的空余。 */
          applyOffset(box.l, box.t);
          if (posChanged) {
            const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
            const wantX = Math.round(pos.x / scale) + dx;
            const wantY = Math.round(pos.y / scale) + dy;
            await win.setPosition(new LogicalPosition(wantX, wantY));
          }
          if (sizeChanged) await win.setSize(new LogicalSize(box.w, box.h));
        } catch {
          // 失败回滚，下一轮重试（窗口最小化 / 被系统拒绝时会发生）
          applyOffset(prev.l, prev.t);
          fit = prev;
        } finally {
          inFlight = false;
          // 落定后再量一次：这次缩放期间内容可能又变了（例如菜单尺寸测得晚一拍）
          if (!disposed) schedule();
        }
      })();
    };

    let frame = 0;
    const schedule = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    // DOM 增删 / class 与 style 变化（浮层开合）→ 立刻重量
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });

    const timer = window.setInterval(schedule, POLL_MS);
    /* 从隐藏恢复时补测一次：隐藏期间的尺寸变化不会触发 MutationObserver */
    const onVisibility = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);

    /* 上界（显示器工作区）是异步的：拿到后补测一次；拖到别的显示器 / DPI 变化时重取。
       注意 onMoved 会被我们自己的 setPosition 触发，但重测若无变化就不会再动窗口，不构成回环。
       拖动时 onMoved 会连发几十次，而每次重取是 2 个 IPC（main_work_area + outer_position）：
       节流到 MOVE_REFRESH_MS 一次，尾随补一次保证停手后读到最终位置。 */
    let lastRefreshAt = 0;
    let pendingRefresh: number | undefined;
    const requestFitRefresh = () => {
      const wait = lastRefreshAt + MOVE_REFRESH_MS - performance.now();
      if (wait > 0) {
        if (pendingRefresh === undefined) {
          pendingRefresh = window.setTimeout(() => {
            pendingRefresh = undefined;
            requestFitRefresh();
          }, wait);
        }
        return;
      }
      lastRefreshAt = performance.now();
      void refreshFitBounds().then(schedule);
    };

    /* 首帧先等上界就位再测量：此刻 `--fit-w` 还是令牌里的 100vw（= 初始 384×360 窗口），
       抢跑会把胶囊按「168px 宽的窗口」排版、文字换成两行、包围盒更小 —— 正是修复前
       那个自我坍缩正反馈的第一拍。等一次 IPC（本机 <5ms）换掉这一拍，代价可忽略。
       `refreshFitBounds()` 内部已 catch 一切异常并回落到视口，所以 then 一定会跑到。 */
    void refreshFitBounds().then(schedule);

    let offMoved: (() => void) | undefined;
    void win
      .onMoved(requestFitRefresh)
      .then((off) => {
        /* 监听器注册是异步的：卸载可能先发生，此时必须立刻退订，否则窗口活多久漏多久 */
        if (disposed) off();
        else offMoved = off;
      })
      .catch(() => {
        /* 浏览器 mock / 窗口已销毁：没有移动事件，忽略 */
      });

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      offMoved?.();
      if (pendingRefresh !== undefined) window.clearTimeout(pendingRefresh);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
