/**
 * [v3.1] 画布缩放：**只由用户决定**，不再跟窗口大小联动。
 *
 * 上一版的 `fitZoom` 把 `min(宽/1250, 高/820)` 写死在渲染里：窗口一变整块板就跟着
 * 放大缩小，于是「窗口大小」与「板子大小」被焊在一起 —— 用户把窗拉宽，卡片跟着变胖，
 * 想看得更细反而没法；内容永远刚好铺满，滚轮也就永远没东西可滚。
 *
 * 现在拆开：倍率是一个**持久化**的用户偏好（默认 100%），改它的只有三条路：
 *   · Ctrl + 滚轮（主路径，按指针位置锚定，指哪儿缩哪儿）
 *   · Ctrl + `=` / Ctrl + `-` / Ctrl + `0`（键盘可达，也能一键回 100%）
 *   · 直接改 localStorage 里那条（调试用，不对外承诺）
 *
 * 钳制 0.5–2：再小字就糊成一片，再大只是重复放大同一批像素。
 * 锚点的道理：缩放前记下指针指向的**画布设计点**，缩放后把滚动条挪回去，
 * 让那一点停在原来的屏幕位置 —— 否则每次 Ctrl + 滚轮都往左上角跑。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;

const ZOOM_STORAGE_KEY = "patina:dashboard-zoom:v1";
/** 滚轮灵敏度：deltaY 乘上它再取 e 的幂，正负两个方向的手感对称 */
const WHEEL_SENSITIVITY = 0.0015;
const KEY_STEP = 0.1;
/** 百分比徽标在最后一次缩放后停留多久 */
const IDLE_HIDE_MS = 900;
const PERSIST_DELAY_MS = 240;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  return Math.round(clamped * 1000) / 1000;
}

export function readStoredZoom(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    if (!raw) return DEFAULT_ZOOM;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampZoom(parsed) : DEFAULT_ZOOM;
  } catch {
    /* 隐私模式 / 存储被禁：记不住就记不住，不该因此白屏 */
    return DEFAULT_ZOOM;
  }
}

function writeStoredZoom(zoom: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    /* 同上：落盘失败不影响当次缩放 */
  }
}

interface ZoomAnchor {
  /** 指针所在的画布设计点 */
  contentX: number;
  contentY: number;
  /** 指针在滚动容器里的视口坐标 */
  viewX: number;
  viewY: number;
}

export interface BoardZoomState {
  zoom: number;
  /** 刚缩放过（给百分比徽标用；静息时它是 false） */
  adjusting: boolean;
}

export function useBoardZoom(hostRef: RefObject<HTMLElement | null>): BoardZoomState {
  const [zoom, setZoom] = useState(readStoredZoom);
  const [adjusting, setAdjusting] = useState(false);
  /** 目标倍率：滚轮连发时以它为准，不必等 React 重渲染 */
  const targetRef = useRef(zoom);
  /** 画面上真正生效的倍率：算锚点必须用它（目标可能已经跑到下一档了） */
  const renderedRef = useRef(zoom);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const idleTimer = useRef<number | null>(null);
  const persistTimer = useRef<number | null>(null);

  const apply = useCallback((next: number) => {
    const value = clampZoom(next);
    if (value === targetRef.current) return;
    targetRef.current = value;
    setZoom(value);
    setAdjusting(true);

    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => writeStoredZoom(value), PERSIST_DELAY_MS);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setAdjusting(false), IDLE_HIDE_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
  }, []);

  /* 滚轮：普通滚轮交给原生滚动（上下翻、Shift 横向翻），Ctrl / ⌘ + 滚轮才缩放。
   * 必须自己 addEventListener 并标 `passive: false` —— React 的 onWheel 是 passive 的，
   * 拦不住 WebView2 的整页缩放。 */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const rect = host.getBoundingClientRect();
      const viewX = event.clientX - rect.left;
      const viewY = event.clientY - rect.top;
      /* 行模式（老式鼠标 / 触控板）deltaY 是"行"，换算成像素级再算比例 */
      const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const rendered = renderedRef.current;
      const next = clampZoom(targetRef.current * Math.exp(-deltaY * WHEEL_SENSITIVITY));
      if (next === targetRef.current) return;

      anchorRef.current = {
        contentX: (host.scrollLeft + viewX) / rendered,
        contentY: (host.scrollTop + viewY) / rendered,
        viewX,
        viewY,
      };
      apply(next);
    };

    host.addEventListener("wheel", handleWheel, { passive: false });
    return () => host.removeEventListener("wheel", handleWheel);
  }, [apply, hostRef]);

  /* 缩放提交到 DOM 之后再把滚动条挪回锚点（顺序反了会按旧尺寸算，锚点漂） */
  useLayoutEffect(() => {
    const host = hostRef.current;
    renderedRef.current = zoom;
    const anchor = anchorRef.current;
    if (!host || !anchor) return;
    anchorRef.current = null;
    host.scrollLeft = anchor.contentX * zoom - anchor.viewX;
    host.scrollTop = anchor.contentY * zoom - anchor.viewY;
  }, [zoom, hostRef]);

  /* 键盘：Ctrl + `=` / `-` / `0`。没有这条，只能靠鼠标的用户（或指针设备坏了）就调不动 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;
      const step = event.key === "=" || event.key === "+"
        ? KEY_STEP
        : event.key === "-" || event.key === "_"
          ? -KEY_STEP
          : null;
      if (step === null) {
        if (event.key !== "0") return;
        event.preventDefault();
        anchorRef.current = null;
        apply(DEFAULT_ZOOM);
        return;
      }
      event.preventDefault();
      anchorRef.current = null;
      apply(targetRef.current + step);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [apply]);

  return { zoom, adjusting };
}
