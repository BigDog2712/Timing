/**
 * Timing — 应用引导（App 挂载时执行一次）
 * -----------------------------------------------------------------------------
 * 1. 订阅后端事件（timer:state-changed 为权威状态；tray/app 事件驱动瞬时 UI）。
 * 2. 主题：订阅 theme-changed（主窗不代转，各窗各自订阅）+ system 跟随 + 首帧读 theme_get。
 * 3. 首帧加载：计时状态 + 事项列表 + 设置。
 * 4. 崩溃恢复：若启动时检测到 active 会话（session 非空），弹恢复对话框（AC-14）。
 * 5. 首帧可见性：K-1 主窗口 visible:false 防白闪，待 DOM 至少绘制一帧后调一次
 *    show_window，兑现 AC-01「启动即见常驻药丸」且不回归白闪。
 */
import { useEffect } from 'react';
import { ipc } from '../services/ipc';
import { highlightPill } from '../services/highlightActions';
import { themeActions } from '../services/themeActions';
import { openNewNote } from '../services/noteActions';
import { reminderActions } from '../services/reminderActions';
import { todoNudgeActions } from '../services/todoNudgeActions';
import { IS_MOBILE } from '../lib/platform';
import { useItemStore } from '../stores/itemStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useThemeStore } from '../stores/themeStore';
import { useTimerStore } from '../stores/timerStore';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';
import { IPC_EVENTS } from '../types/domain';
import type {
  CountdownFinishedPayload,
  MdSyncReport,
  ReminderFiredPayload,
  ThemeChangedPayload,
  TimerState,
  TodoNudgePayload,
} from '../types/domain';
import { useTauriEvent } from './useTauriEvent';

/**
 * K-1 窗口显式显示护栏：跨 React `StrictMode` 的双执行也只显示一次。
 * `show_window` 本身幂等，此护栏避免多余 IPC 与竞态。
 */
let windowShown = false;

export function useAppBootstrap(): void {
  /* ---- 事件订阅（Rust -> 前端） ---- */
  useTauriEvent<TimerState>(IPC_EVENTS.timerStateChanged, (payload) => {
    useTimerStore.getState().setState(payload);
  });

  /* [V0.3.1] 托盘双击 = 高亮定位小条（颜色取设置里的「高亮颜色」）。
     原「托盘左键 → 显隐悬浮条」已随显隐功能一起删除。 */
  useTauriEvent<unknown>(IPC_EVENTS.trayHighlight, () => {
    void highlightPill();
  });

  // 托盘「设置…」由 Rust 侧直接递落点（[0.12.1] 起走 tools_navigation::open_settings，
  // 落点是分析窗的 settings 视图），不再广播事件
  // （原 IPC_EVENTS.openSettings 后端从未 emit，是死常量，已删除）。

  useTauriEvent<unknown>(IPC_EVENTS.openNewItem, () => {
    useUiStore.getState().openPanel('create');
  });

  /* [V0.3.3] `shortcut:triggered` 订阅已随全局快捷键整体下架（ADR-022）：
     此前它只是「结构预留」（后端从不 emit），留着等于一个永不触发的死常量。 */

  /* ---- 主题变更广播：各窗自订阅（K-21），主窗不代转 ---- */
  useTauriEvent<ThemeChangedPayload>(IPC_EVENTS.themeChanged, (payload) => {
    useThemeStore.getState().apply(payload.mode, payload.accents);
  });

  /* ---- [批2 N-6] 倒计时到点：仅视觉提示（系统通知由后端发；到点判定归 Rust） ---- */
  useTauriEvent<CountdownFinishedPayload>(IPC_EVENTS.countdownFinished, (payload) => {
    const mins = Math.round(payload.targetSec / 60);
    useUiStore.getState().setNotice({ text: `倒计时 ${mins} 分钟已到点`, tone: 'info' });
    useUiStore.getState().flashEnded();
    void useTimerStore.getState().refresh().catch(() => undefined);
  });

  /* ---- [批2 N-5] 提醒到点：±60s 聚合为单张浮出卡；不自动结束计时 ---- */
  useTauriEvent<ReminderFiredPayload>(IPC_EVENTS.reminderFired, (payload) => {
    reminderActions.onFired(payload);
  });

  /* ---- [V0.3.12] 待办两级提醒：T-15 轻提醒（改时间）/ T-5 自动开始询问（ADR-030） ---- */
  useTauriEvent<TodoNudgePayload>(IPC_EVENTS.todoNudge, (payload) => {
    todoNudgeActions.onNudge(payload);
  });

  /* ---- [批2 N-4] 便利贴窗口开关：主窗无需更新自身状态（备注逐窗自持），
   *      订阅仅为占位——将来若主窗要展示「已开便利贴数」可在此对接。 ---- */
  useTauriEvent<unknown>(IPC_EVENTS.noteWindowOpened, () => undefined);
  useTauriEvent<unknown>(IPC_EVENTS.noteWindowClosed, () => undefined);

  /* ---- [V0.4.0] Markdown 同步把文件改动写回 SQL：刷新受影响的 store ----
     事件只在「真的导入了数据」时发；空轮询不打扰界面。 */
  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    if (report.kinds.includes('timers') || report.kinds.includes('notes')) {
      void useItemStore
        .getState()
        .reload()
        .catch(() => undefined);
    }
    if (report.kinds.includes('timers')) {
      void useTimerStore
        .getState()
        .refresh()
        .catch(() => undefined);
    }
    /* 待办区块的勾选 / 改标题会改 `todos`，待办窗口不能停在旧列表上。 */
    if (report.kinds.includes('todos')) {
      void useTodoStore
        .getState()
        .reload()
        .catch(() => undefined);
    }
    useUiStore.getState().setNotice({
      text: `已从 Markdown 同步 ${report.imported} 条更新`,
      tone: 'info',
    });
  });

  /* ---- [批2 E] 托盘 IA → 主窗浮层（原生托盘菜单项触发；前端零渲染） ---- */
  useTauriEvent<unknown>(IPC_EVENTS.openNewNote, () => {
    void openNewNote();
  });

  /* ---- system 模式跟随系统明暗（matchMedia 监听） ---- */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (useThemeStore.getState().mode === 'system') useThemeStore.getState().setLocalMode('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* ---- 首帧可见性：先渲染、后显示（K-1 / AC-01） ----
   * 独立 effect：与首帧数据加载解耦——即便加载抛错，窗口也必须显示，杜绝「初始化异常 → 永久不可见」。
   * 双 `requestAnimationFrame` 保证至少绘制一帧后再显示（不白闪）；并**并联 setTimeout(50) 兜底**：
   * WebView2 在窗口 visible:false 时可能暂停 rAF → 仅靠 rAF 会永不触发，故以定时器保底。
   * 两路共用 windowShown 护栏（先到先得，只显示一次）；cleanup 取消未执行的 rAF / 定时器
   * （StrictMode 双执行安全且幂等）。 */
  useEffect(() => {
    /* 移动端：窗口随 Activity 出现，`show_window` 是桌面桩（移动后端为空操作），
       没有白闪可防，跳过这一跳 IPC。其余订阅与首帧加载照旧。 */
    if (IS_MOBILE || windowShown) return;
    const show = () => {
      if (windowShown) return;
      windowShown = true;
      // 浏览器 mock 的 show_window 为 no-op；真实环境失败也不应阻断 UI。
      void ipc.showWindow().catch(() => undefined);
    };
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(show);
    });
    const timer = window.setTimeout(show, 50);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, []);

  /* ---- 首帧加载 + 崩溃恢复检测 + 主题初始化 ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [state] = await Promise.all([
          useTimerStore.getState().refresh(),
          useItemStore.getState().reload(),
          useSettingsStore.getState().reload(),
          /* [P1 优化] 参考设置（Timing v1.7.3 口径）首帧也要拉：否则
             settingsStore.referenceSettings 恒为 null，倒计时默认时长等字段等于假接线。
             拉取失败不拖垮首帧，回落容忍。 */
          useSettingsStore
            .getState()
            .reloadReference()
            .catch(() => null),
        ]);
        if (cancelled) return;
        if (state.session) useUiStore.getState().setRecover(state.session);
      } catch {
        if (!cancelled) {
          useUiStore.getState().setNotice({ text: '初始化失败，请稍后重试', tone: 'danger' });
        }
      }
      /* 主题初始化独立于数据加载：即便上面失败也尝试应用后端主题 */
      try {
        await themeActions.init();
      } catch {
        if (!cancelled) useThemeStore.getState().markLoaded();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
