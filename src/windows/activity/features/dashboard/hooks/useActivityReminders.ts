/**
 * 活动提醒卡的数据与写动作（[本轮 T04] 工具页「活动提醒」分区迁入主界面新卡）。
 * -----------------------------------------------------------------------------
 * 分层纪律（V-2c）：本 hook 是**唯一**的写出口 —— 组件目录（`components/reminder/`）
 * 里 0 处 `invoke(`，写动作一律经 `platform/runtime/toolsRuntimeGateway`。
 *
 * 为什么读侧复用 `toolsRuntimeSnapshotStore`：它带事件订阅 + 快照去抖（旧值不回退），
 * `shell/hooks/useAppShellRenderedView` 与 `startupWarmupService` 已经在预热它，
 * 新卡挂载时大概率命中缓存 —— 零新增命令、零新增事件（`EXPECTED_EMIT_SITES = 18` 不动）。
 *
 * `buildActivityReminderRuleRows` 从已下线的 `toolsViewModel.ts` 原样搬来（含
 * `labelSnapshot` 缺省回落），收敛在 `../services/activityReminderRows.ts` 作为唯一
 * 实现，本 hook 只消费——不重新发明第二份口径。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderTarget,
  ActivityReminderWebCandidate,
  ToolsRuntimeSnapshot,
} from "../../../shared/types/tools.ts";
import type { ActivityReminderRuleRowViewModel } from "../../tools/types.ts";
import { buildActivityReminderRuleRows } from "../services/activityReminderRows.ts";
import {
  loadActivityReminderAppCandidates,
  loadActivityReminderCategoryCandidates,
  loadActivityReminderWebCandidates,
  subscribeActivityReminderTargetCandidateInvalidation,
} from "../../tools/services/activityReminderTargetCandidates.ts";
import { toolsRuntimeSnapshotStore } from "../../tools/services/toolsRuntimeSnapshotStore.ts";
import {
  createActivityReminderRule,
  disableActivityReminderRule,
  setActivityReminderEnabled,
  updateActivityReminderLimit,
} from "../../../platform/runtime/toolsRuntimeGateway.ts";

const MS_PER_MINUTE = 60_000;

type ActivityCandidateMode = "app" | "category" | "web";
type CandidateLoadState = "idle" | "loading" | "ready" | "error";

const CANDIDATE_MODES: readonly ActivityCandidateMode[] = ["app", "category", "web"];

const EMPTY_RULE_ROWS: ActivityReminderRuleRowViewModel[] = [];

/**
 * 活动提醒卡的单一数据/写出口。挂载即拉快照与三组候选目标；
 * 分类候选的标签跟语言走（切语言后重拉一次，与旧工具页同口径）。
 */
export function useActivityReminders() {
  const locale = useLocale();
  const uiText = useLocaleText();
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot | null>(
    () => toolsRuntimeSnapshotStore.getCurrentSnapshot(),
  );
  const [loadError, setLoadError] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  /** 最近一次写动作失败的一句提示（复用既有 `tools.actionFailed` 键，不新增 i18n 行） */
  const [actionError, setActionError] = useState<string | null>(null);
  const actionInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshRequestRef = useRef(0);

  const [appCandidates, setAppCandidates] = useState<ActivityReminderAppCandidate[]>([]);
  const [categoryCandidates, setCategoryCandidates] = useState<ActivityReminderCategoryCandidate[]>([]);
  const [webCandidates, setWebCandidates] = useState<ActivityReminderWebCandidate[]>([]);
  const [candidateLoadState, setCandidateLoadState] = useState<Record<ActivityCandidateMode, CandidateLoadState>>(
    () => ({ app: "idle", category: "idle", web: "idle" }),
  );
  const loadedCandidateModesRef = useRef(new Map<ActivityCandidateMode, string>());
  const candidateRequestIdsRef = useRef({ app: 0, category: 0, web: 0 });

  /* 快照：订阅 + 冷启动拉一次（toolsRuntimeSnapshotStore 自带去抖与事件合流） */
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((next) => {
      if (!cancelled) {
        setSnapshot(next);
        setLoadError(false);
      }
    });
    const requestId = ++refreshRequestRef.current;
    toolsRuntimeSnapshotStore.refreshSnapshot()
      .catch((error) => {
        console.warn("load tools snapshot for reminder card failed", error);
        if (!mountedRef.current || refreshRequestRef.current !== requestId) return;
        if (toolsRuntimeSnapshotStore.getCurrentSnapshot() === null) setLoadError(true);
      });
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /* 候选目标：分类目录的标签随语言变化，语言键变了就整组重拉 */
  const loadCandidateMode = useCallback(async (mode: ActivityCandidateMode) => {
    if (loadedCandidateModesRef.current.has(mode)
      && (mode !== "category" || loadedCandidateModesRef.current.get(mode) === locale)) return;
    const requestId = candidateRequestIdsRef.current[mode] + 1;
    candidateRequestIdsRef.current[mode] = requestId;
    setCandidateLoadState((current) => ({ ...current, [mode]: "loading" }));
    try {
      if (mode === "app") {
        const candidates = await loadActivityReminderAppCandidates();
        if (candidateRequestIdsRef.current.app !== requestId || !mountedRef.current) return;
        setAppCandidates(candidates);
      } else if (mode === "category") {
        const candidates = await loadActivityReminderCategoryCandidates(uiText);
        if (candidateRequestIdsRef.current.category !== requestId || !mountedRef.current) return;
        setCategoryCandidates(candidates);
      } else {
        const candidates = await loadActivityReminderWebCandidates();
        if (candidateRequestIdsRef.current.web !== requestId || !mountedRef.current) return;
        setWebCandidates(candidates);
      }
      loadedCandidateModesRef.current.set(mode, locale);
      setCandidateLoadState((current) => ({ ...current, [mode]: "ready" }));
    } catch (error) {
      console.warn(`load ${mode} activity reminder candidates failed`, error);
      if (candidateRequestIdsRef.current[mode] === requestId && mountedRef.current) {
        setCandidateLoadState((current) => ({ ...current, [mode]: "error" }));
      }
    }
  }, [locale, uiText]);

  useEffect(() => {
    for (const mode of CANDIDATE_MODES) void loadCandidateMode(mode);
  }, [loadCandidateMode]);

  useEffect(() => subscribeActivityReminderTargetCandidateInvalidation(() => {
    loadedCandidateModesRef.current.clear();
    candidateRequestIdsRef.current.app += 1;
    candidateRequestIdsRef.current.category += 1;
    candidateRequestIdsRef.current.web += 1;
    setCandidateLoadState({ app: "idle", category: "idle", web: "idle" });
    for (const mode of CANDIDATE_MODES) void loadCandidateMode(mode);
  }), [loadCandidateMode]);

  const retryCandidates = useCallback((mode: ActivityCandidateMode) => {
    loadedCandidateModesRef.current.delete(mode);
    void loadCandidateMode(mode);
  }, [loadCandidateMode]);

  /* 写动作：单飞（同一时刻只允许一个在途），快照由网关返回值发布回 store */
  const executeAction = useCallback(async (
    actionKey: string,
    action: () => Promise<ToolsRuntimeSnapshot>,
  ): Promise<boolean> => {
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    setBusyAction(actionKey);
    setActionError(null);
    try {
      toolsRuntimeSnapshotStore.publishSnapshot(await action());
      return true;
    } catch (error) {
      console.warn(`activity reminder action failed: ${actionKey}`, error);
      setActionError(uiText.tools.actionFailed);
      return false;
    } finally {
      actionInFlightRef.current = false;
      setBusyAction(null);
    }
  }, [uiText]);

  const createRule = useCallback((
    target: ActivityReminderTarget,
    labelSnapshot: string,
    limitMinutes: number,
    message: string,
  ) => executeAction(
    "create-activity-reminder",
    () => createActivityReminderRule({
      target,
      labelSnapshot,
      limitMs: Math.max(1, limitMinutes) * MS_PER_MINUTE,
      message,
    }),
  ), [executeAction]);

  const setRuleEnabled = useCallback((id: number, enabled: boolean) => executeAction(
    `toggle-activity-reminder:${id}`,
    () => setActivityReminderEnabled(id, enabled),
  ), [executeAction]);

  const updateLimit = useCallback((id: number, limitMinutes: number) => executeAction(
    `update-activity-reminder:${id}`,
    () => updateActivityReminderLimit(id, Math.max(1, limitMinutes) * MS_PER_MINUTE),
  ), [executeAction]);

  const disableRule = useCallback((id: number) => executeAction(
    `disable-activity-reminder:${id}`,
    () => disableActivityReminderRule(id),
  ), [executeAction]);

  const ruleRows = useMemo(
    () => (snapshot ? buildActivityReminderRuleRows(snapshot, locale) : EMPTY_RULE_ROWS),
    [locale, snapshot],
  );

  return {
    ruleRows,
    hasSnapshot: snapshot !== null,
    loadError,
    retryLoad: useCallback(() => {
      setLoadError(false);
      void toolsRuntimeSnapshotStore.refreshSnapshot().catch(() => setLoadError(true));
    }, []),
    busyAction,
    appCandidates,
    categoryCandidates,
    webCandidates,
    candidateLoadState,
    retryCandidates,
    actionError,
    createRule,
    setRuleEnabled,
    updateLimit,
    disableRule,
  };
}
