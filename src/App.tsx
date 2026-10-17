/**
 * TickBar — App（薄装配层 + 窗口 label 路由，ADR-009 §1）
 * -----------------------------------------------------------------------------
 * 载入时按当前窗口 label 分流（src/lib/window）：
 *   - settings → 独立设置窗，**只渲染 SettingsPanel**（不渲染主窗层）；
 *   - todos    → 独立事项窗，只渲染 TodosWindow；
 *   - note     → 独立便利贴窗（label note-{id}），只渲染 NoteWindow；
 *   - main     → 固定 384×360 透明置层：药丸 / 面板 / 菜单 / 撤销条 / 对话框。
 */
import { Batch2Overlays } from './components/Batch2Overlays';
import { ContextMenu } from './components/menu/ContextMenu';
import { ItemMenu } from './components/menu/ItemMenu';
import { NoteWindow } from './components/note/NoteWindow';
import { NotesListPopover } from './components/note/NotesListPopover';
import { ItemPicker } from './components/panel/ItemPicker';
import { PillBar } from './components/pill/PillBar';
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
import { currentWindowKind } from './lib/window';
import { useUiStore } from './stores/uiStore';
import { openTodosWindow } from './services/todosActions';

export default function App() {
  const kind = currentWindowKind();

  if (kind === 'settings') return <SettingsWindow />;
  if (kind === 'todos') return <TodosWindow />;
  if (kind === 'timer') return <TimerWindow />;
  if (kind === 'note') return <NoteWindow />;

  return <MainWindow />;
}

/** 主窗（label = main）：固定透明置层 + 各形态组件 */
function MainWindow() {
  useAppBootstrap();

  const collapsed = useUiStore((s) => s.collapsed);
  const panel = useUiStore((s) => s.panel);
  const menuOpen = useUiStore((s) => s.menuOpen);
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

      {menuOpen && <ContextMenu />}
      {itemMenu && <ItemMenu />}
      {notesListPos && <NotesListPopover pos={notesListPos} onClose={closeNotesList} />}
      <Batch2Overlays />
      {recover && <RecoverDialog session={recover} />}
      <NoticeBar />
    </div>
  );
}
