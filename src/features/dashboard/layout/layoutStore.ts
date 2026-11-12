/**
 * [v3] 布局落盘：**两个键**，都只进 localStorage，坏数据自愈并回写一次。
 *
 *   · `LAYOUT_STORAGE_KEY`  —— 当前排布（每拖一下都会写）
 *   · `DEFAULT_LAYOUT_STORAGE_KEY` —— 主人自己存的「默认布局」（只在点「保存布局」时写）
 *
 * 为什么两个键而不是一个键里塞 `default` 字段：当前排布每帧都在变，而默认版是**快照**。
 * 混在一个键里，任何一次拖动都要把默认版整份重写一遍（1250 画布上七八张卡，
 * 拖动时每帧几百字节 JSON 的序列化纯属白烧）；分开写还顺带保证「存完之后接着拖」
 * 不会把已存的默认版改掉。
 *
 * 为什么不进库：布局是**这台机器这扇窗**的观感（显示器尺寸、缩放、个人习惯），
 * 与 `timing.db` 里的计时事实不同级。为什么不拆多键：`version + cards` 必须同批生效，
 * 拆键一定出现「新版本号配旧卡表」。
 *
 * v3 的键换了（`patina:dashboard-layout:v3`）：v2 的 `x` 是列号，混读会把卡叠在一起。
 * 旧键**不删**——它还在 v2 用户机器上，删了等于替人清数据；新键第一次读不到时会走
 * `normalizeLayout` 的 v2 迁移路径（见 `boardStore` 的 `hydrate`）。
 */
import { LAYOUT_STORAGE_KEY, LAYOUT_VERSION, type DashboardLayout } from "./contract";
import { cloneDefaultLayout } from "./defaultLayout";
import { normalizeLayout } from "./normalizeLayout";

/** v2 的键：迁移时读它一次，之后再不碰。 */
export const LEGACY_STORAGE_KEY = "patina:dashboard-layout:v2";

/** 主人自己存的默认布局（点「保存布局」写入，点「恢复默认」读回）。 */
export const DEFAULT_LAYOUT_STORAGE_KEY = "patina:dashboard-layout:default:v1";

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

function parse(raw: string | null): { value: unknown; broken: boolean } {
  if (raw === null) return { value: undefined, broken: false };
  try {
    return { value: JSON.parse(raw), broken: false };
  } catch {
    return { value: undefined, broken: true };
  }
}

export function loadLayout(): LoadLayoutResult {
  const store = storage();
  if (!store) {
    return { layout: cloneDefaultLayout(), repaired: false, reason: "storage-unavailable" };
  }

  /* 主人存过默认版就以它为「回落的落点」：坏存档不该把人辛苦摆的布局换成出厂那版。 */
  const fallback = loadSavedDefault() ?? cloneDefaultLayout();

  const own = parse(store.getItem(LAYOUT_STORAGE_KEY));
  if (own.broken) {
    const result = normalizeLayout(undefined, fallback);
    saveLayout(result.layout);
    console.warn("[dashboard-layout] v3 布局不是合法 JSON，已回默认并回写");
    return { ...result, reason: "invalid-json" };
  }
  if (own.value !== undefined) {
    const result = normalizeLayout(own.value, fallback);
    if (result.repaired) {
      saveLayout(result.layout);
      console.warn(`[dashboard-layout] 布局已自愈（${result.reason ?? "unknown"}）并回写`);
    }
    return result;
  }

  /* 第一次读 v3：如果有 v2 布局，迁移它（用户的排布不丢），否则默认布局。 */
  const legacy = parse(store.getItem(LEGACY_STORAGE_KEY));
  if (legacy.value !== undefined) {
    const migration = normalizeLayout({ ...(legacy.value as object), version: 2 }, fallback);
    saveLayout(migration.layout);
    console.info("[dashboard-layout] 已把 v2 网格布局迁移为 v3 自由摆位");
    return { ...migration, repaired: false, reason: "migrated-from-v2" };
  }

  /* 真正的第一次运行：不写盘（写盘等于替用户做了一次决定）。 */
  return { layout: normalizeLayout(DEFAULT_PROBE, fallback).layout, repaired: false, reason: null };
}

export function saveLayout(layout: DashboardLayout): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...layout, version: LAYOUT_VERSION }));
  } catch {
    /* 配额满 / 被拒：布局是观感偏好，丢一次不致命，不打断主界面。 */
  }
}

/** 测试与「恢复出厂」共用：清掉这一键，下次读就是出厂布局。 */
export function resetLayout(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    /* 同上，静默 */
  }
}

/* ── 默认布局：主人用「保存布局」存下来的那一版 ── */

/**
 * 读已保存的默认布局；**没存过 / 存档坏了**一律返回 null（调用方回落出厂）。
 *
 * 只认「版本号对 + 卡表非空」这一种快照：坏 JSON、旧版本号、空卡表都当没存过 ——
 * 把一张都没有的板子当成默认布局最恶：主人点一下「恢复默认」，主界面当场变白。
 */
export function loadSavedDefault(): DashboardLayout | null {
  const store = storage();
  if (!store) return null;

  const { value, broken } = parse(store.getItem(DEFAULT_LAYOUT_STORAGE_KEY));
  if (broken) {
    console.warn("[dashboard-layout] 保存的默认布局不是合法 JSON，已忽略");
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const candidate = value as { version?: unknown; cards?: unknown };
  if (candidate.version !== LAYOUT_VERSION) return null;
  if (!Array.isArray(candidate.cards) || candidate.cards.length === 0) return null;

  /* 逐卡自愈（未知类型丢掉、越界矩形修到合法、重复 uid 重新发号），剩下的照用。 */
  const healed = normalizeLayout(value, cloneDefaultLayout());
  return healed.reason === "empty-cards" ? null : healed.layout;
}

/** 存过默认布局没有（工具栏据此决定要不要露出「出厂布局」那一条）。 */
export function hasSavedDefault(): boolean {
  return loadSavedDefault() !== null;
}

/** 存这份快照为默认布局（覆盖旧的默认，不动当前排布那一键）。 */
export function saveSavedDefault(layout: DashboardLayout): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify({ ...layout, version: LAYOUT_VERSION }));
  } catch {
    /* 配额满 / 被拒：同 saveLayout，静默。 */
  }
}

/** 回到「从未存过默认布局」的状态（下次「恢复默认」即出厂布局）。 */
export function clearSavedDefault(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DEFAULT_LAYOUT_STORAGE_KEY);
  } catch {
    /* 静默 */
  }
}

/** 当前生效的默认布局：主人存过就是那一版，否则出厂。 */
export function loadDefaultLayout(): DashboardLayout {
  return loadSavedDefault() ?? cloneDefaultLayout();
}

/** 供 `normalizeLayout` 生成出厂布局用的空输入（不是合法布局 → 走默认分支）。 */
const DEFAULT_PROBE = { version: LAYOUT_VERSION, cards: [] as unknown[] };
