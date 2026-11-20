/**
 * 最近前台应用（8 条以内）：给药丸「新建事项」的应用绑定提供**可直接点的候选**。
 *
 * 用户口径：快捷添加事项时要能绑定应用。要求用户自己敲 `code.exe` 不现实，
 * 而药丸没有应用选择器 —— 所以只记住"最近切到过的前台应用"，按时间倒序排列。
 * 数据来自追踪引擎已有的广播（`active-window-changed`，见 `useForegroundAppLog`），
 * 不新增任何 IPC / 事件。
 *
 * 只存**键**（`normalizeAppKey` 的产物）与展示名；自家进程（药丸 / 分析窗）不收 ——
 * 绑自己没有任何意义，且用户点药丸时前台必然变成它。
 */
import { create } from 'zustand';

import { normalizeAppKey } from '../../shared/appKey.ts';

export interface RecentApp {
  /** `normalizeAppKey` 的产物（`code.exe` / `com.x.y`） */
  key: string;
  /** 展示名：去掉首尾引号、去掉末尾 `.exe`（`Code` / `com.x.y`） */
  label: string;
}

const MAX_RECENT_APPS = 8;
const SELF_EXE_KEY = 'timing.exe';

/** 展示名：`"C:\\...\\Code.exe"` → `Code`。只做展示，不做键（键另走 `normalizeAppKey`）。 */
function displayName(exeName: string): string {
  const bare = exeName.trim().replace(/^"+|"+$/g, '').trim();
  const base = bare.split(/[\\/]/).pop() ?? bare;
  return base.replace(/\.exe$/i, '') || base;
}

interface RecentAppsState {
  apps: RecentApp[];
  /** 记一次前台应用（同键去重并提到最前；自家的 / 空名直接忽略） */
  note: (exeName: string) => void;
}

export const useRecentAppsStore = create<RecentAppsState>((set) => ({
  apps: [],
  note: (exeName) => {
    const key = normalizeAppKey(exeName);
    if (!key || key === SELF_EXE_KEY) return;
    const label = displayName(exeName) || key;
    set((state) => {
      const rest = state.apps.filter((app) => app.key !== key);
      return { apps: [{ key, label }, ...rest].slice(0, MAX_RECENT_APPS) };
    });
  },
}));