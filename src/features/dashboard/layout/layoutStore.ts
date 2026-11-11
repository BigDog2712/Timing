/**
 * [P1 · 0.12.1] 布局落盘：单键 localStorage，坏数据自愈并**回写一次**。
 *
 * 为什么不进库：布局是**这台机器这扇窗**的观感（显示器尺寸、缩放、个人习惯），
 * 与 `timing.db` 里的计时事实不同级；P3 若要跨端同步再单独立项，别顺手塞进 KV 命令面。
 * 为什么不拆多键：`version + cards` 必须同批生效，拆键一定出现「新版本号配旧卡表」。
 */
import { LAYOUT_STORAGE_KEY, type DashboardLayout } from "./contract";
import { normalizeLayout } from "./normalizeLayout";

export interface LoadLayoutResult {
  layout: DashboardLayout;
  /** 这次启动是否修过（修过就要回写，否则每次启动都自愈一遍）。 */
  repaired: boolean;
  reason: string | null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    /* 隐私模式 / 被策略禁用：布局退回默认，**不抛** —— 主界面不能因为读不到偏好就白屏。 */
    return null;
  }
}

export function loadLayout(): LoadLayoutResult {
  const store = storage();
  if (!store) return { layout: normalizeLayout(undefined).layout, repaired: false, reason: "storage-unavailable" };

  const raw = store.getItem(LAYOUT_STORAGE_KEY);
  if (raw === null) {
    /* 第一次运行：不写盘（写盘等于替用户做了一次决定），直接用默认布局。 */
    return { layout: normalizeLayout({ version: 1, cards: [] }).layout, repaired: false, reason: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const result = normalizeLayout(undefined);
    saveLayout(result.layout);
    console.warn("[dashboard-layout] 存储的布局不是合法 JSON，已回默认并回写");
    return { ...result, reason: "invalid-json" };
  }

  const result = normalizeLayout(parsed);
  if (result.repaired) {
    saveLayout(result.layout);
    console.warn(`[dashboard-layout] 布局已自愈（${result.reason ?? "unknown"}）并回写`);
  }
  return result;
}

export function saveLayout(layout: DashboardLayout): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* 配额满 / 被拒：布局是观感偏好，丢一次不致命，不打断主界面。 */
  }
}

/** 测试与「恢复默认」共用：清掉这一键，下次读就是出厂布局。 */
export function resetLayout(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    /* 同上，静默 */
  }
}
