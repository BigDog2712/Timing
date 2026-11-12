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
import { useWindowAutoFit } from '../hooks/useWindowAutoFit';
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

  const collapsed = useUiStore((s) => s.collapsed);
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
     悬浮条形态整段短路：条本来就常驻，没有「收回」这回事。 */
  const leaveTimer = useRef<number | null>(null);
  const lastExpandAt = useRef(0);

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

  return (
    <div className="layer">
      <div className="layer__stack" onMouseEnter={cancelCollapse} onMouseLeave={scheduleCollapse}>
        {collapsed ? <CollapsedDot /> : <PillBar />}
        {!collapsed && <UndoBar />}
        {!collapsed && panel === 'create' && <ItemPicker />}
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
