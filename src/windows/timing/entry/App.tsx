/**
 * Timing — App（薄装配层 + 窗口 label 路由，ADR-009 §1）
 * -----------------------------------------------------------------------------
 * 载入时按当前窗口 label 分流（src/lib/window）：
 *   - todos    → 独立事项窗，只渲染 TodosWindow；
 *   - note     → 独立便利贴窗（label note-{id}），只渲染 NoteWindow；
 *   - main     → 无画布置层（ADR-020）：药丸 / 面板 / 菜单 / 撤销条 / 对话框由 auto-fit 撑窗口。
 *
 * [0.12.1] 设置只剩**一个**家：分析窗（label `patina`）的 settings 视图。独立设置窗
 * （label `settings`）与药丸里的内联设置面板**都已下线**（T04b 删掉最后一支），所有
 * 「打开设置」入口都改成把分析窗叫到前台并落到它的 settings 视图。
 *
 * 移动端（Android 包，DESIGN-ANDROID-V1 §1.2）：整个桌面壳被编译期常量短路，
 * 直接渲染 MobileShell（4 Tab + 覆盖层）。手机单窗口，没有 label 路由。
 */
import { useCallback, useEffect, useRef } from 'react';
import { Batch2Overlays } from '../components/Batch2Overlays';
import { ItemMenu } from '../components/menu/ItemMenu';
import { MobileShell } from '../components/mobile/MobileShell';
import { NoteWindow } from '../components/note/NoteWindow';
import { NotesListPopover } from '../components/note/NotesListPopover';
import { ItemPicker } from '../components/panel/ItemPicker';
import { PillBar } from '../components/pill/PillBar';
import { TimerPanel } from '../components/pill/TimerPanel';
import { RecordsPanel } from '../components/records/RecordsPanel';
import { RecoverDialog } from '../components/recover/RecoverDialog';
import { TodayDigest } from '../components/todos/TodayDigest';
import { TodosWindow } from '../components/todos/TodosWindow';
import { TimerWindow } from '../components/timer/TimerWindow';
import { UndoBar } from '../components/undo/UndoBar';
import { CollapsedDot } from '../components/ui/CollapsedDot';
import { NoticeBar } from '../components/ui/NoticeBar';
import { useAppBootstrap } from '../hooks/useAppBootstrap';
import { useHostIntentBridge } from '../services/hostIntentBridge';
import { useItemsRefreshOnFocus } from '../hooks/useItemsRefreshOnFocus';
import { useAppBindingAutoTimer } from '../hooks/useAppBindingAutoTimer';
import { useWindowAutoFit } from '../hooks/useWindowAutoFit';
import { HIGHLIGHT_MS } from '../lib/constants';
import { isDragActive } from '../lib/dragState';
import { IS_MOBILE } from '../lib/platform';
import { currentWindowKind } from '../lib/window';
import { useUiStore, hasOpenSurface } from '../stores/uiStore';
import { useAppearanceStore } from '../stores/appearanceStore';
import { openTodosWindow } from '../services/todosActions';

export default function App() {
  /* 编译期分叉：桌面构建里 IS_MOBILE 被替换成 false，下面的移动整块（含 MobileShell
     及其全部依赖）会被摇树删除，桌面四窗口行为一字不变。 */
  if (IS_MOBILE) return <MobileShell />;

  const kind = currentWindowKind();

  if (kind === 'todos') return <TodosWindow />;
  if (kind === 'timer') return <TimerWindow />;
  if (kind === 'note') return <NoteWindow />;

  return <MainWindow />;
}

/** 主窗（label = main）：无画布置层（ADR-020） + 各形态组件 */
function MainWindow() {
  useAppBootstrap();
  /* [P0-04/P0-05] 分析窗的意图执行端：挂一次即够（挂两处会让同一条 toggle 连切两下） */
  useHostIntentBridge();
  /* [P1 修复] 把真实 OS 窗口收缩到可见内容包围盒：透明空白区不再吞掉桌面点击 */
  useWindowAutoFit();
  /* [V0.11.7] 本窗与事项窗是两个 webview、两份 store：在事项窗「编辑事项」里改名、
     或在那边新建的事项，主窗的悬浮条 / 菜单 / 便利贴列表都还停在旧快照上。
     与事项窗同一处收口（`useItemsRefreshOnFocus`），理由见该 hook 的文件注释。 */
  useItemsRefreshOnFocus();
  /* [0.13] 切到「绑定了事项」的应用时自动接管计时：结束当前这段，按绑定事项重新开始。
     订阅的是追踪引擎的前台变化广播（真的变了才发），所以"进入这个应用"天然只触发一次。 */
  useAppBindingAutoTimer();

  const collapsed = useUiStore((s) => s.collapsed);
  const highlightSeq = useUiStore((s) => s.highlightSeq);
  const panel = useUiStore((s) => s.panel);
  const itemMenu = useUiStore((s) => s.itemMenu);
  const notesListPos = useUiStore((s) => s.notesListPos);
  const closeNotesList = useUiStore((s) => s.closeNotesList);
  const recover = useUiStore((s) => s.recover);
  const floatForm = useAppearanceStore((s) => s.floatForm);

  /* [V0.11.4] 小圆点形态下，点开只是「临时看一眼」：鼠标移出窗口就收回圆点。
     两条护栏：
       · 延时 300ms 再收，且移回来就取消——否则点开瞬间窗口从 22px 变成一条，
         指针可能正好落在新窗口外面，会立刻被收回，看起来像「点不动」；
       · 面板 / 菜单 / 提醒卡 / 恢复框 / 撤销条开着时不收（见 hasOpenSurface）——
         那些是用户主动打开的，收起来等于替他把东西关掉。
     悬浮条形态整段短路：条本来就常驻，没有「收回」这回事。
     [0.13.x] 高亮的「临时展开」也走这一套（见下方「点托盘图标 → 圆点临时变条」段），
     所以这里仍是**唯一**的收回入口。 */
  const leaveTimer = useRef<number | null>(null);
  const lastExpandAt = useRef(0);
  /** 指针此刻是否压在本层上（临时展开到点要不要收回，靠它判断，见下方段注释） */
  const hovered = useRef(false);

  useEffect(() => {
    if (!collapsed) lastExpandAt.current = Date.now();
  }, [collapsed]);

  const cancelCollapse = useCallback(() => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    if (floatForm !== 'dot' || collapsed) return;
    cancelCollapse();
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      /* 刚展开的 400ms 内先不动：让窗口尺寸变化与指针位置先稳定下来 */
      if (Date.now() - lastExpandAt.current < 400) return;
      if (hasOpenSurface()) return;
      useUiStore.getState().setCollapsed(true);
    }, 300);
  }, [floatForm, collapsed, cancelCollapse]);

  useEffect(() => cancelCollapse, [cancelCollapse]);

  /* 收回入口要保持「最新的一份」但又不能进 effect 依赖：高亮那个 effect 只许吃
     `highlightSeq`（它自己在回调里改 `collapsed`，若把 collapsed 写进依赖，
     临时展开的瞬间 effect 就会被重建、顺手清掉刚排上的定时器）。 */
  const scheduleRef = useRef(scheduleCollapse);
  useEffect(() => {
    scheduleRef.current = scheduleCollapse;
  }, [scheduleCollapse]);

  /* 指针进 / 出本层：除了原先的「取消 / 排一次收回」，还要维护 `hovered`——
     它只被高亮的收回判定读一次（见下），语义是「用户此刻正在看条」。 */
  const handleEnter = useCallback(() => {
    hovered.current = true;
    cancelCollapse();
  }, [cancelCollapse]);

  const handleLeave = useCallback(() => {
    hovered.current = false;
    scheduleCollapse();
  }, [scheduleCollapse]);

  /* =============================================================================
   * [0.13.x] 点托盘图标 → 圆点临时变条、闪完再收回（用户口径 3）
   * -----------------------------------------------------------------------------
   * 用户原话：「点击任务栏图标的高亮提醒在小圆点形态失效。应小圆点变为悬浮条形态高亮，
   * 结束后恢复小圆点形态」。事实校正：圆点形态**已经**接了高亮（CollapsedDot 订阅
   * `highlightSeq` 挂 `data-highlight`，`styles/dot.css` 有 `.dot[data-highlight="true"]`），
   * 只是 33px 的圆点上闪一圈内侧描边太弱看不见。所以这里补的不是闪烁，是**形态临时切换**。
   *
   * 四条边界，逐条对应实现：
   *   1. 收回复用 `scheduleCollapse`（同一个定时器 + 300ms 延迟 + 刚展开 400ms 内不动 +
   *      `hasOpenSurface()` 护栏）——本段**只负责在 HIGHLIGHT_MS 之后叫它一声**，
   *      一行判定都不重写；指针若还压在条上，则连叫都不叫，留给既有的
   *      `onMouseLeave → scheduleCollapse`，那正是同一套护栏的常规路径。
   *   2. 不碰 `setFloatForm`：临时展开只改 `uiStore.collapsed`。`floatForm === 'dot'`
   *      是用户的**常驻形态设定**，替他把条放出来看一眼不能顺手改掉设定。
   *   3. 拖动中不展开：`isDragActive()`。圆点本身是窗口抓手，拖动期间改窗口尺寸
   *      会把这次拖动打断（用户正在移动窗口，不是要看条）。
   *   4. 连点两次不叠收回定时器：收回定时器只有 `flashTimer` 一个 ref，重排前先 clear。
   * ========================================================================== */
  const flashTimer = useRef<number | null>(null);
  /** 当前这次展开是不是「高亮临时放出来的」——用户自己展开的条不归本段收 */
  const tempExpanded = useRef(false);

  const clearFlashTimer = useCallback(() => {
    if (flashTimer.current != null) {
      window.clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
  }, []);
  /* 卸载（切窗 / 退出）时不留孤儿定时器 */
  useEffect(() => clearFlashTimer, [clearFlashTimer]);

  useEffect(() => {
    if (highlightSeq <= 0) return;
    if (floatForm !== 'dot') {
      /* 常驻悬浮条：条本来就在，闪就完了。这里仍要清一次——用户可能在高亮这 2.5s 内
         把常驻形态从 dot 改成 bar，残着的定时器到点会把他的条收起来（越权）。 */
      clearFlashTimer();
      tempExpanded.current = false;
      return;
    }
    const ui = useUiStore.getState();
    if (ui.collapsed) {
      if (isDragActive()) return; /* 边界 3：拖动中不打断 */
      ui.setCollapsed(false); /* 边界 2：只动 collapsed，不动 floatForm */
      tempExpanded.current = true;
    } else if (!tempExpanded.current) {
      /* 条是用户自己展开的（点圆点 / 分析窗意图）：不接管收回，到点也不收 */
      return;
    }
    clearFlashTimer(); /* 边界 4：连点只留一个收回定时器 */
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      tempExpanded.current = false;
      /* 边界 1：指针在条上 → 用户正在看，不替他收；离开时那条 mouseleave 会接管 */
      if (hovered.current) return;
      scheduleRef.current();
    }, HIGHLIGHT_MS);
  }, [highlightSeq, floatForm, clearFlashTimer]);

  return (
    <div className="layer">
      <div className="layer__stack" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        {collapsed ? <CollapsedDot /> : <PillBar />}
        {!collapsed && <UndoBar />}
        {!collapsed && panel === 'create' && <ItemPicker />}
        {!collapsed && panel === 'timer' && <TimerPanel />}
        {!collapsed && panel === 'records' && <RecordsPanel />}
        {!collapsed && panel === 'digest' && <TodayDigest onClose={() => useUiStore.getState().closePanel()} onViewRecords={() => { useUiStore.getState().closePanel(); void openTodosWindow(); }} />}
      </div>

      {itemMenu && <ItemMenu />}
      {notesListPos && <NotesListPopover pos={notesListPos} onClose={closeNotesList} />}
      <Batch2Overlays />
      {recover && <RecoverDialog session={recover} />}
      <NoticeBar />
    </div>
  );
}
