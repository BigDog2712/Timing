/**
 * [0.13 · 需求 1.4] 多布局库：**一个独立键**，不与「当前排布」合并。
 *
 *   · `LAYOUT_STORAGE_KEY`（`contract.ts`）—— 当前排布，每拖一下就写一次；
 *   · `DEFAULT_LAYOUT_STORAGE_KEY`（老「默认布局」，`layoutStore.ts`）—— 只读：迁移来源
 *     与「当前排布键坏了」时的落点；
 *   · **本文件** `patina:dashboard-layout:library:v1` —— 一组快照（`activeId` + `items`）。
 *
 * 为什么不塞进「当前排布」那一个键：库是一组必须**原子读写**的快照，而当前排布每帧都在变。
 * 混在一个键里，每次拖动都要把整库重写一遍（`layoutStore.ts` 头注释已为同一个理由把默认版
 * 拆出去）。为什么不拆成「每布局一个键」：`activeId` 与 `items` 必须同批生效，拆键一定会
 * 出现「新 activeId 配旧 items」。
 *
 * `factory` 是**虚拟条目**：内置、不可删、不落库，内容 = `cloneDefaultLayout()`。它是唯一
 * 永远存在的落点，所以「删掉当前布局」不需要问用户"你要去哪"。
 *
 * 本文件只做「纯函数 + 存储」，**没有 React、没有 store**：需要响应式的地方在
 * `boardStore`（它持有 `library` 状态并调这里的函数）。
 */
import type { DashboardLayout } from "./contract";
import { cloneDefaultLayout, cloneLayout } from "./defaultLayout";
import { loadSavedDefault } from "./layoutStore";
import { normalizeLayout } from "./normalizeLayout";

export const LIBRARY_STORAGE_KEY = "patina:dashboard-layout:library:v1";
export const LIBRARY_VERSION = 1;
/** 内置的出厂条目 id（保留值，不落库） */
export const FACTORY_LAYOUT_ID = "factory";

export interface SavedLayout {
  id: string;
  /** 用户数据：写入后**不随切语言变**（所以迁移时生成一次就存成字符串） */
  name: string;
  createdAt: number;
  updatedAt: number;
  layout: DashboardLayout;
}

export interface LayoutLibrary {
  version: typeof LIBRARY_VERSION;
  /** `"factory"` 或 `items` 里某条的 id */
  activeId: string;
  /** **不含** factory（factory 是虚拟条目） */
  items: SavedLayout[];
}

/** 布局管理弹层要渲染的一行。`factory` 的 `name` 为空，由调用方填本地化名字。 */
export interface LayoutEntryView {
  id: string;
  name: string;
}

export interface LoadLibraryResult {
  library: LayoutLibrary;
  /** 本次是否从老「默认布局」键迁移过来（弹层可据此给一句提示） */
  migrated: boolean;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    /* 隐私模式 / 被策略禁用：库退回空（只剩 factory），**不抛** —— 主界面不能因为
     * 读不到偏好就白屏（与 `layoutStore` 同一条纪律）。 */
    return null;
  }
}

/**
 * 新布局 id。
 * 不用 `crypto.randomUUID()!`：release 是 `panic=abort`，用户可达路径上禁非空断言；
 * 老 WebView2 也可能没有 `randomUUID`。两条路都走，缺一条就退到时间戳 + 随机串。
 */
function newLayoutId(): string {
  const api = globalThis.crypto as Crypto | undefined;
  if (api && typeof api.randomUUID === "function") return api.randomUUID();
  return `layout-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyLibrary(): LayoutLibrary {
  return { version: LIBRARY_VERSION, activeId: FACTORY_LAYOUT_ID, items: [] };
}

/** 把存下来的一份布局逐卡自愈（未知 kind 丢弃、越界矩形修到合法、重复 uid 重发号）。 */
function healLayout(value: unknown): DashboardLayout | null {
  const healed = normalizeLayout(value, cloneDefaultLayout());
  return healed.reason === "empty-cards" ? null : healed.layout;
}

function parseEntry(value: unknown): SavedLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<SavedLayout>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (raw.id === FACTORY_LAYOUT_ID) return null;
  /* 没有 layout 的条目直接丢：`normalizeLayout` 对"非对象输入"的回答是**出厂布局**，
   * 拿它当兜底会把一条坏条目变成一张「叫着用户起的名字、装着出厂排布」的假布局
   * —— 比"这条不见了"更难解释。 */
  if (!raw.layout || typeof raw.layout !== "object" || Array.isArray(raw.layout)) return null;
  const layout = healLayout(raw.layout);
  if (!layout) return null;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : 0;
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "",
    createdAt,
    updatedAt,
    layout,
  };
}

/** 坏形状（不是对象 / 版本不对 / items 不是数组）一律返回 null（→ 调用方走迁移或空库）。 */
function parseLibrary(value: unknown): LayoutLibrary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LayoutLibrary>;
  if (raw.version !== LIBRARY_VERSION) return null;
  if (!Array.isArray(raw.items)) return null;
  const items = raw.items.map(parseEntry).filter((item): item is SavedLayout => item !== null);
  const activeId = typeof raw.activeId === "string" ? raw.activeId : FACTORY_LAYOUT_ID;
  /* activeId 指向一条已被丢掉 / 不存在的布局 → 回落 factory，而不是留一个空指针
   * （表现会是「弹层里没有一行是高亮的」+「点切换没反应」）。 */
  const known = items.some((item) => item.id === activeId);
  return { version: LIBRARY_VERSION, activeId: known ? activeId : FACTORY_LAYOUT_ID, items };
}

/**
 * 读布局库。
 *
 * 三种情况：
 *   ① 键在且形状对 → 用它（逐条自愈，不修就不回写：坏的那条被丢掉这件事本身要留给用户看见）；
 *   ② 键不在 / 坏的 JSON / 形状不对 → 若老「默认布局」键在，**迁移**它成 `items[0]` 并
 *      `activeId = 它`（老键**不删**：删了等于替人清数据）；
 *   ③ 都没有 → 空库（只有 factory）。
 *
 * 迁移必须**落盘**：id 要跨会话稳定，否则 `activeId` 每次启动都换一个值，用户看到的
 * 是「当前布局每开一次窗就变成"未选中"」。
 */
export function loadLibrary(options: { now: number; migratedName: string }): LoadLibraryResult {
  const store = storage();
  if (!store) return { library: emptyLibrary(), migrated: false };

  let parsed: LayoutLibrary | null = null;
  try {
    const raw = store.getItem(LIBRARY_STORAGE_KEY);
    if (raw !== null) parsed = parseLibrary(JSON.parse(raw) as unknown);
  } catch {
    console.warn("[dashboard-layout] 布局库不是合法 JSON，已尝试从默认布局迁移");
  }
  if (parsed) return { library: parsed, migrated: false };

  const legacy = loadSavedDefault();
  if (!legacy) return { library: emptyLibrary(), migrated: false };

  const entry: SavedLayout = {
    id: newLayoutId(),
    name: options.migratedName,
    createdAt: options.now,
    updatedAt: options.now,
    layout: legacy,
  };
  const library: LayoutLibrary = {
    version: LIBRARY_VERSION,
    activeId: entry.id,
    items: [entry],
  };
  saveLibrary(library);
  console.info("[dashboard-layout] 已把老的「默认布局」导入布局库");
  return { library, migrated: true };
}

export function saveLibrary(library: LayoutLibrary): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
  } catch {
    /* 配额满 / 被拒：布局是观感偏好，丢一次不致命，不打断主界面。 */
  }
}

/**
 * 把当前排布存成库里的一条新布局并设为当前。
 * **存深拷贝**：之后接着拖卡，库里那一份不能跟着变（`slice` 浅拷会让两处共享 card 对象）。
 */
export function createLayout(
  library: LayoutLibrary,
  name: string,
  layout: DashboardLayout,
  now: number,
): { library: LayoutLibrary; entry: SavedLayout } {
  const entry: SavedLayout = {
    id: newLayoutId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    layout: cloneLayout(layout),
  };
  return {
    library: { ...library, activeId: entry.id, items: [...library.items, entry] },
    entry,
  };
}

/**
 * 删一条布局。**删的是当前那条时 `activeId` 回落 `factory`** ——
 * 不猜「用剩下的最近一条」：猜错会让用户以为自己删错了东西。
 */
export function removeLayout(library: LayoutLibrary, id: string): LayoutLibrary {
  const items = library.items.filter((item) => item.id !== id);
  if (items.length === library.items.length) return library;
  return {
    version: LIBRARY_VERSION,
    activeId: library.activeId === id ? FACTORY_LAYOUT_ID : library.activeId,
    items,
  };
}

/** 解析某条布局的排布（深拷贝）。找不到 / `factory` → 出厂排布。 */
export function resolveLayout(library: LayoutLibrary, id: string): DashboardLayout {
  if (id === FACTORY_LAYOUT_ID) return cloneDefaultLayout();
  const found = library.items.find((item) => item.id === id);
  return found ? cloneLayout(found.layout) : cloneDefaultLayout();
}

/** 弹层要渲染的行：factory 永远第一行（内置、不可删）。 */
export function libraryEntries(library: LayoutLibrary): LayoutEntryView[] {
  return [
    { id: FACTORY_LAYOUT_ID, name: "" },
    ...library.items.map((item) => ({ id: item.id, name: item.name })),
  ];
}

/** 某个 id 是不是内置的出厂条目。 */
export function isFactoryLayout(id: string): boolean {
  return id === FACTORY_LAYOUT_ID;
}
