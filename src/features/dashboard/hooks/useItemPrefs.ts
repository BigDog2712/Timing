import { useCallback, useEffect, useRef, useState } from "react";

import {
  listTimingItems,
  type TimingItem,
} from "../../../platform/persistence/timingReadRepository.ts";
import {
  getSettings,
  type HostSettingsSnapshot,
} from "../../../platform/desktop/hostSettingsGateway.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import {
  clampRecentCount,
  normalizeItemTimers,
  RECENT_ITEMS_DEFAULT,
  withItemTimer,
  itemTimerMinutes,
  type ItemTimers,
} from "../services/itemPrefs.ts";

/**
 * 「事项管理」弹层的数据层（[本轮]）。
 *
 * 两类数据、两条只读命令：
 *   · `list_items` → 事项本身（`isPinned` / `sortOrder` / `updatedAt` 由 Rust 的 `Item` 透传）；
 *   · `get_settings` → `itemsTimers`（itemId → 默认时长分钟）、`itemsRecentCount`、`itemsShowRecent`。
 * 两条**并发**发起：串行会让弹层先空一下再出第二组，观感像闪了两下。
 *
 * ## 为什么 `getSettings` 失败要静默降级
 *
 * 浏览器里单测 / vite 单跑时 `platform/desktop/hostSettingsGateway` 会直接 throw
 * （`isTauriRuntime()` 判假）。这不是用户可见的错误：事项清单还能看、常用/取消常用还能发意图，
 * 只有时长徽标与「近期事项」条数回落出厂值。所以 catch 后降级，**不**把整卡打红。
 *
 * ## 乐观更新 + 待确认集（照 `useTodayItems` 的 `pendingRenamesRef`）
 *
 * 写意图走事件桥，**没有回执**：宿主落库到下一次刷新之间有一小段。这段时间里：
 *   ① 本地立刻改（用户点了「取消常用」就得立刻从常用组消失）；
 *   ② 把 `id → 本地值` 记进待确认表；
 *   ③ 后续每次刷回来若还是**旧值**，用本地值覆盖（不弹回去）；
 *   ④ 刷回来与本地一致（宿主已落库）才把这条从待确认表里摘掉。
 */

/** 本地能改的事项字段（`timerMinutes` 不在其中：它落设置，另走 `applyLocalTimer`）。 */
export interface LocalItemPatch {
  name?: string;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface ItemPrefsState {
  items: TimingItem[];
  timers: ItemTimers;
  recentCount: number;
  showRecent: boolean;
  status: LoadStatus;
  /** 重新拉一次（`active` 为 false 时调用无效，下次激活会自己拉） */
  reload: () => void;
  /** 写意图**已发出**之后调用：本地先改，别让下一次刷新覆盖回去 */
  applyLocalItem: (itemId: number, patch: LocalItemPatch) => void;
  /** 时长意图**已发出**之后调用：`null` = 回到正计时 */
  applyLocalTimer: (itemId: number, minutes: number | null) => void;
}

/** 设置快照里的三个偏好字段（其余字段本弹层不关心，原样忽略）。 */
interface PrefsSettings {
  timers: ItemTimers;
  recentCount: number;
  showRecent: boolean;
}

/** `get_settings` 返回的脏快照 → 三个偏好；缺字段 / 脏值一律回落出厂值。 */
export function readPrefsSettings(raw: HostSettingsSnapshot | unknown): PrefsSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const count = Number(value.itemsRecentCount);
  return {
    timers: normalizeItemTimers(value.itemsTimers as ItemTimers | undefined),
    recentCount: Number.isFinite(count) ? clampRecentCount(count) : RECENT_ITEMS_DEFAULT,
    /* 只认显式的 `false`：字段缺失（旧宿主）时按“显示”处理，与宿主默认一致 */
    showRecent: value.itemsShowRecent !== false,
  };
}

const FALLBACK_SETTINGS: PrefsSettings = {
  timers: {},
  recentCount: RECENT_ITEMS_DEFAULT,
  showRecent: true,
};

/**
 * @param active 弹层是否开着。关着的时候一条命令都不发 —— 这张卡在仪表盘上常年挂着，
 *   挂载即读设置会让每次进主界面多两次 IPC，而用户可能根本不打开这个弹层。
 */
export function useItemPrefs(active: boolean): ItemPrefsState {
  const [items, setItems] = useState<TimingItem[]>([]);
  const [timers, setTimers] = useState<ItemTimers>({});
  const [recentCount, setRecentCount] = useState(RECENT_ITEMS_DEFAULT);
  const [showRecent, setShowRecent] = useState(true);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const pendingItemsRef = useRef<Map<number, LocalItemPatch>>(new Map());
  const pendingTimersRef = useRef<Map<number, number | null>>(new Map());

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));

    const load = async () => {
      const [itemsResult, settingsResult] = await Promise.allSettled([
        listTimingItems(),
        getSettings(),
      ]);
      if (cancelled) return;

      const loadedItems = itemsResult.status === "fulfilled" ? itemsResult.value : [];
      const loadedSettings = settingsResult.status === "fulfilled"
        ? readPrefsSettings(settingsResult.value)
        : FALLBACK_SETTINGS;
      if (settingsResult.status === "rejected") {
        console.warn("read host settings for item prefs failed, falling back", settingsResult.reason);
      }

      /* ③④ 待确认事项：返回的一致就摘掉，不一致就用本地值覆盖 */
      const pendingItems = pendingItemsRef.current;
      const nextItems = loadedItems.map((item) => {
        const patch = pendingItems.get(item.id);
        if (!patch) return item;
        const keys = Object.keys(patch) as (keyof LocalItemPatch)[];
        const confirmed = keys.every((key) => item[key] === patch[key]);
        if (confirmed) {
          pendingItems.delete(item.id);
          return item;
        }
        return { ...item, ...patch };
      });

      /* 时长：宿主侧“没有这个键”= 正计时，与本地 `null` 等价。
         注意必须**整体重新赋值**（`withItemTimer` 在 `minutes === null` 时会删键），
         就地 `Object.assign` 会把该删的键留下 —— 表现为「清不掉的默认时长」。 */
      let nextTimers: ItemTimers = { ...loadedSettings.timers };
      const pendingTimers = pendingTimersRef.current;
      for (const [itemId, minutes] of Array.from(pendingTimers)) {
        if (itemTimerMinutes(loadedSettings.timers, itemId) === minutes) {
          pendingTimers.delete(itemId);
          continue;
        }
        nextTimers = withItemTimer(nextTimers, itemId, minutes);
      }

      setItems(nextItems);
      setTimers(nextTimers);
      setRecentCount(loadedSettings.recentCount);
      setShowRecent(loadedSettings.showRecent);
      if (itemsResult.status === "fulfilled") {
        setStatus("ready");
      } else {
        console.warn("load items for item prefs failed", itemsResult.reason);
        setStatus((current) => (current === "ready" ? current : "error"));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [active, attempt]);

  const applyLocalItem = useCallback((itemId: number, patch: LocalItemPatch) => {
    /* 先剥掉 `undefined`：`{ ...item, sortOrder: undefined }` 会把 `sortOrder` 变成
       `undefined`（类型说是 number，运行期不是），而待确认表里那条也永远等不到“一致”，
       于是一次次把 undefined 覆盖回去。调用方按“传了就是改了”使用，这里兜底。 */
    const clean: LocalItemPatch = {};
    if (patch.name !== undefined) clean.name = patch.name;
    if (patch.isPinned !== undefined) clean.isPinned = patch.isPinned;
    if (patch.sortOrder !== undefined) clean.sortOrder = patch.sortOrder;
    if (Object.keys(clean).length === 0) return;
    const pending = pendingItemsRef.current;
    pending.set(itemId, { ...pending.get(itemId), ...clean });
    setItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, ...clean } : item
    )));
  }, []);

  const applyLocalTimer = useCallback((itemId: number, minutes: number | null) => {
    pendingTimersRef.current.set(itemId, minutes);
    setTimers((current) => withItemTimer(current, itemId, minutes));
  }, []);

  return {
    items,
    timers,
    recentCount,
    showRecent,
    status,
    reload,
    applyLocalItem,
    applyLocalTimer,
  };
}
