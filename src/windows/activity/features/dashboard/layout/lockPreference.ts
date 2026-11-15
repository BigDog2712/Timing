/**
 * [0.13 · 需求 1.3] 布局锁定的偏好：**一个独立键**，不进 `DashboardLayout`。
 *
 * 为什么不放进 `DashboardLayout`：放进去就得升 `LAYOUT_VERSION`（`contract.ts`），
 * 而升版本会触发 `normalizeLayout` 的**全量自愈路径** —— 用户的排布会被"修"一次。
 * 为了一个布尔值付这个风险不值得。
 *
 * 为什么也不跟布局库走：锁是「这台机器现在的操作模式」，不是布局的属性。切换布局
 * 不该把锁定状态改掉（否则「换个布局」会悄悄解锁/上锁）。
 *
 * 存的是 `"1"` / `"0"`（而不是 JSON 布尔）：存档的可读性优先，且 localStorage 里
 * 一个字符比 `true`/`false` 少一次误读形状的机会。坏值按**未锁定**处理 ——
 * 宁可让用户能拖动，也不要让一个读不懂的字符串把界面永久锁死。
 */
export const LOCKED_STORAGE_KEY = "patina:dashboard-layout:locked:v1";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    /* 隐私模式 / 被策略禁用：当作未锁定（不可锁定不是故障，锁不上才是）。 */
    return null;
  }
}

export function readLocked(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(LOCKED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLocked(locked: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LOCKED_STORAGE_KEY, locked ? "1" : "0");
  } catch {
    /* 配额满 / 被拒：锁不落盘不致命（本次会话内仍然生效） */
  }
}
