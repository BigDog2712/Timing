/**
 * TickBar — App（薄装配层 + 窗口 label 路由，ADR-009 §1）
 * -----------------------------------------------------------------------------
 * 载入时按当前窗口 label 分流（src/lib/window）：
 *   - settings → 独立设置窗，**只渲染 SettingsPanel**（不渲染主窗层）；
 *   - todos    → 独立事项窗，只渲染 TodosWindow；
 *   - note     → 独立便利贴窗（label note-{id}），只渲染 NoteWindow；
 *   - panel    → 插件面板窗（label panel-{pluginId}-{panelId}），只渲染 PluginPanelWindow；
 *   - main     → 无画布置层（ADR-020）：药丸 / 面板 / 菜单 / 撤销条 / 对话框由 auto-fit 撑窗口。
 *
 * 移动端（Android 包，DESIGN-ANDROID-V1 §1.2）：整个桌面壳被编译期常量短路，
 * 直接渲染 MobileShell（4 Tab + 覆盖层）。手机单窗口，没有 label 路由。
 */
import { Batch2Overlays } from './components/Batch2Overlays';
import { ItemMenu } from './components/menu/ItemMenu';
import { MobileShell } from './components/mobile/MobileShell';
import { NoteWindow } from './components/note/NoteWindow';
import { NotesListPopover } from './components/note/NotesListPopover';
import { ItemPicker } from './components/panel/ItemPicker';
import { PillBar } from './components/pill/PillBar';
import { PluginPanelWindow } from './components/plugin/PluginPanelWindow';
import { RecordsPanel } from './components/records/RecordsPanel';
import { RecoverDialog } from './components/recover/RecoverDialog';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { SettingsWindow } from './components/settings/SettingsWindow';
import { TodayDigest } from './components/todos/TodayDigest';
import { TodosWindow } from './components/todos/TodosWindow';
import { TimerWindow } from './components/timer/TimerWindow';
import { UndoBar } from './components/undo/UndoBar';
import { CollapsedDot } from './components/ui/CollapsedDot';
import { NoticeBar } from './components/ui/NoticeBar';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useWindowAutoFit } from './hooks/useWindowAutoFit';
import { IS_MOBILE } from './lib/platform';
import { currentWindowKind } from './lib/window';
import { useUiStore } from './stores/uiStore';
import { openTodosWindow } from './services/todosActions';

export default function App() {
  /* 编译期分叉：桌面构建里 IS_MOBILE 被替换成 false，下面的移动整块（含 MobileShell
     及其全部依赖）会被摇树删除，桌面四窗口行为一字不变。 */
  if (IS_MOBILE) return <MobileShell />;

  const kind = currentWindowKind();

  if (kind === 'settings') return <SettingsWindow />;
  if (kind === 'todos') return <TodosWindow />;
  if (kind === 'timer') return <TimerWindow />;
  if (kind === 'note') return <NoteWindow />;
  if (kind === 'panel') return <PluginPanelWindow />;

  return <MainWindow />;
}

/** 主窗（label = main）：无画布置层（ADR-020） + 各形态组件 */
function MainWindow() {
  useAppBootstrap();
  /* [P1 修复] 把真实 OS 窗口收缩到可见内容包围盒：透明空白区不再吞掉桌面点击 */
  useWindowAutoFit();

  const collapsed = useUiStore((s) => s.collapsed);
  const panel = useUiStore((s) => s.panel);
  const itemMenu = useUiStore((s) => s.itemMenu);
  const notesListPos = useUiStore((s) => s.notesListPos);
  const closeNotesList = useUiStore((s) => s.closeNotesList);
  const recover = useUiStore((s) => s.recover);

  return (
    <div className="layer">
      <div className="layer__stack">
        {collapsed ? <CollapsedDot /> : <PillBar />}
        {!collapsed && <UndoBar />}
        {!collapsed && panel === 'create' && <ItemPicker />}
        {!collapsed && panel === 'records' && <RecordsPanel />}
        {!collapsed && panel === 'digest' && <TodayDigest onClose={() => useUiStore.getState().closePanel()} onViewRecords={() => { useUiStore.getState().closePanel(); void openTodosWindow(); }} />}
        {!collapsed && panel === 'settings' && <SettingsPanel />}
      </div>

      {itemMenu && <ItemMenu />}
      {notesListPos && <NotesListPopover pos={notesListPos} onClose={closeNotesList} />}
      <Batch2Overlays />
      {recover && <RecoverDialog session={recover} />}
      <NoticeBar />
    </div>
  );
}
