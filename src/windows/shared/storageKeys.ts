/**
 * Timing — localStorage 键的唯一口径 + 老键只读兼容（V0.5.0 改名配套）
 * -----------------------------------------------------------------------------
 * 改名把 5 个键从 `tickbar.*` 挪到 `timing.*`。用户的偏好还躺在老键里，
 * 直接换键 = 升级后主题回默认、不透明度回 100%、倒计时档位丢失——用户不知道
 * 发生了什么，只会觉得「更新把我设置弄没了」。
 *
 * 读取语义（`docs/rename-v0.5.0/ARCHITECTURE.md` §6.2，五处一致）：
 *   **读新键 → 无则读老键 → 命中即回写新键 → 老键保留不删**
 * 老键留一个版本（PRD §2.3）：万一要回滚 0.4.1，它的偏好还在。
 *
 * 为什么收敛到本文件：5 个键分散在 4 个文件里各写一遍字面量时，「新增一个键」
 * 与「补齐老键回落」是两次独立改动，漏一次就是静默丢设置。这里把「新键 / 老键 /
 * 双读 / 双删」做成四个出口，调用方只认逻辑名（`theme` / `fitOffset` …），
 * 不认字符串。
 *
 * ⚠️ `index.html` 的内联防白闪脚本不经过本文件（它必须在样式加载前**同步**执行，
 * 且拿不到模块）：那里是**唯一**保留 `tickbar.theme` 字面量的地方，改动时两处
 * 必须同批（见 ARCHITECTURE §6.2）。
 *
 * 依赖方向：本文件只依赖 `types/domain/constants`（叶子），不反向被 types 依赖。
 */
/* [0.12.1 共享层] 这两个键的**定义**搬到这里：storageKeys 是跨窗共享层，不能反向依赖
   `timing/types/domain/constants`。原来的 constants.ts 改为从本文件 re-export，调用方无感。 */
export const THEME_CACHE_KEY = 'timing.theme';

/** [V0.5.0] 老主题键：只读回落，**不删**（回滚 0.4.1 时它的偏好还在） */
export const THEME_CACHE_KEY_LEGACY = 'tickbar.theme';

/** 逻辑键名（调用方只认它，不认字符串） */
export type StorageKeyName =
  | 'theme'
  | 'appearance'
  | 'countdownArm'
  | 'countdownDuration'
  | 'fitOffset';

/** 新键（0.5.0 起写入的目标）。`theme` 复用 constants 里的常量，避免两处口径分叉 */
export const STORAGE_KEYS: Record<StorageKeyName, string> = {
  theme: THEME_CACHE_KEY,
  appearance: 'timing.appearance.v1',
  countdownArm: 'timing.countdownArm.v1',
  countdownDuration: 'timing.countdownDuration.v1',
  fitOffset: 'timing.fit-offset',
};

/**
 * 老键（0.4.x 及更早写入的位置）。**只读 + 回写新键，不主动删**。
 * 注意 `fitOffset` 老键是**冒号**（`tickbar:fit-offset`），本次统一为点——
 * 不是笔误，是真的历史形态（ARCHITECTURE §6.2 P1-2）。
 */
export const LEGACY_STORAGE_KEYS: Record<StorageKeyName, string> = {
  theme: THEME_CACHE_KEY_LEGACY,
  appearance: 'tickbar.appearance.v1',
  countdownArm: 'tickbar.countdownArm.v1',
  countdownDuration: 'tickbar.countdownDuration.v1',
  fitOffset: 'tickbar:fit-offset',
};

/** localStorage 是否可用（隐私模式 / 配额满 / 非浏览器宿主都会抛） */
function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * 双读：新键优先，没有则回落老键；老键命中时**顺手回写新键**（一次性搬运）。
 * @returns 原始字符串；两处都没有（或存储不可用）返回 null。
 */
export function readKeyWithLegacy(name: StorageKeyName): string | null {
  if (!storageAvailable()) return null;
  const fresh = STORAGE_KEYS[name];
  const legacy = LEGACY_STORAGE_KEYS[name];
  try {
    const current = localStorage.getItem(fresh);
    if (current !== null && current !== '') return current;
    const old = localStorage.getItem(legacy);
    if (old === null || old === '') return null;
    /* 回写失败不影响本次读取：值已经拿在手上，下次再试搬运即可 */
    try {
      localStorage.setItem(fresh, old);
    } catch {
      /* 配额满 / 只读存储：本次仍返回老值 */
    }
    return old;
  } catch {
    return null;
  }
}

/** 写新键（**只写新键**：老键是历史事实，回滚时还要用） */
export function writeKey(name: StorageKeyName, value: string): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEYS[name], value);
  } catch {
    /* 隐私模式 / 配额满：本次会话内仍生效，不打断用户操作 */
  }
}

/** 双删：用户主动清除时必须把老键一起清掉，否则下次读又「复活」了 */
export function removeKey(name: StorageKeyName): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEYS[name]);
  } catch {
    /* 忽略 */
  }
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEYS[name]);
  } catch {
    /* 忽略 */
  }
}

/**
 * 跨窗口 `storage` 事件是否属于某个逻辑键。
 * 新键或老键任一命中都算——老键可能来自升级前仍开着的旧窗口。
 */
export function isKeyEvent(name: StorageKeyName, eventKey: string | null): boolean {
  return eventKey === STORAGE_KEYS[name] || eventKey === LEGACY_STORAGE_KEYS[name];
}
