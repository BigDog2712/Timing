/**
 * Timing — 移动端外壳（4 Tab + 全局覆盖层）
 * -----------------------------------------------------------------------------
 * 职责边界（DESIGN-ANDROID-V1 §2.2 / T7）：
 *   - Tab 路由：timer / items / records / settings，**只渲染当前页**（切 Tab 即重挂载，
 *     数据自然刷新，不需要给每页再造一套「激活时重拉」的口令）；
 *   - 全局覆盖层：崩溃恢复（冷启动必弹）、撤销条、提示条、通知降级条、业务 Sheet；
 *   - 返回键层级：Sheet > Tab（见 `useMobileBackSheet`），不杀进程。
 *
 * 页面本身不持有「当前 Tab」，Sheet 也不进 Tab 栈——两者都在 `mobileUiStore` 里，
 * 这样任意页都能唤起 Sheet，而返回键只有一个处理点。
 */
import { useCallback, useEffect } from 'react';
import { useAppBootstrap } from '../../hooks/useAppBootstrap';
import { useMobileBackSheet } from '../../hooks/useMobileBackSheet';
import { usePillAction } from '../../hooks/usePillAction';
import {
  AlertIcon,
  ClockIcon,
  ListIcon,
  SettingsIcon,
  StickyNoteIcon,
  TimerIcon,
  iconStroke,
} from '../../lib/icons';
import { useMobileUiStore, type MobileSheet, type MobileTab } from '../../stores/mobileUiStore';
import { useUiStore } from '../../stores/uiStore';
import { CountdownSheet } from './CountdownSheet';
import { ItemMenuSheet } from './ItemMenuSheet';
import { ItemsPage } from './ItemsPage';
import { NoteItemSheet } from './NoteItemSheet';
import { NoteSheet } from './NoteSheet';
import { NotesPage } from './NotesPage';
import { RecordEditSheet } from './RecordEditSheet';
import { RecordsPage } from './RecordsPage';
import { RecoverSheet } from './RecoverSheet';
import { SettingsPage } from './SettingsPage';
import { SwitchItemSheet } from './SwitchItemSheet';
import { TodoSwitchSheet } from './SwitchModeSheet';
import { TodoPlanSheet } from './TodoPlanSheet';
import { TimerPage } from './TimerPage';
import { UndoToast } from './UndoToast';

interface TabDef {
  id: MobileTab;
  label: string;
  sub: string;
  Icon: typeof TimerIcon;
}

const TABS: readonly TabDef[] = [
  { id: 'timer', label: '计时', sub: '点一下就开始', Icon: TimerIcon },
  { id: 'items', label: '事项', sub: '待办与今日记录', Icon: ListIcon },
  { id: 'records', label: '记录', sub: '今天 / 本周', Icon: ClockIcon },
  /* [V0.11.0] 便利贴：数据与桌面同一张 notes 表，见 services/mobileNoteActions */
  { id: 'notes', label: '便利贴', sub: '随手记，挂到事项上', Icon: StickyNoteIcon },
  { id: 'settings', label: '设置', sub: '外观 · 插件 · 通用', Icon: SettingsIcon },
];

/** 提示条：手机放在 Tab 栏上方，4s 自动消失（与桌面 NoticeBar 同节奏） */
function MobileNotice() {
  const notice = useUiStore((s) => s.notice);
  const setNotice = useUiStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);

  if (!notice) return null;
  return (
    <div className="m-toast" data-tone={notice.tone} role="status">
      {notice.tone === 'danger' && <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
      <span>{notice.text}</span>
    </div>
  );
}

function SheetHost({ sheet }: { sheet: MobileSheet }) {
  switch (sheet.kind) {
    case 'countdown':
      return <CountdownSheet />;
    case 'switchItem':
      return <SwitchItemSheet />;
    case 'recordEdit':
      return <RecordEditSheet record={sheet.record} />;
    case 'itemMenu':
      return <ItemMenuSheet itemId={sheet.itemId} />;
    case 'todoSwitch':
      return <TodoSwitchSheet todoId={sheet.todoId} title={sheet.title} />;
    case 'noteEdit':
      return <NoteSheet noteId={sheet.noteId} />;
    case 'noteItem':
      return <NoteItemSheet noteId={sheet.noteId} />;
    case 'todoPlan':
      return <TodoPlanSheet title={sheet.title} />;
  }
  /* 穷尽性检查：以后再加一种 Sheet 却忘了在这里接上，TS 直接报错，
     而不是 `default: null` 静默什么都不显示——那种坏法点了没反应、控制台也没有一行字。 */
  const never: never = sheet;
  return never;
}

export function MobileShell() {
  /* 与桌面主窗同一套引导：事件订阅 + 首帧数据 + 崩溃恢复检测（`uiStore.recover`） */
  useAppBootstrap();
  /* [V0.11.22] 悬浮窗那一按的接收端。挂在外壳上而不是某一页：它必须随时在听，
     用户可能停在任何一个 Tab 上点悬浮窗。 */
  usePillAction();

  const tab = useMobileUiStore((s) => s.tab);
  const setTab = useMobileUiStore((s) => s.setTab);
  const sheet = useMobileUiStore((s) => s.sheet);
  const notifyIssue = useMobileUiStore((s) => s.notifyIssue);
  const recover = useUiStore((s) => s.recover);

  useMobileBackSheet(sheet != null);
  /* 恢复面板不可关闭：返回键只把历史条目续上，既不丢决定也不退出应用 */
  const holdRecover = useCallback(() => {
    window.history.pushState({ timingRecover: true }, '');
  }, []);
  useMobileBackSheet(recover != null, holdRecover);

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="m-shell" data-tab={tab}>
      <header className="m-shell__head">
        <h1 className="m-shell__title">{current.label}</h1>
        <p className="m-shell__sub">{current.sub}</p>
      </header>

      <main className="m-shell__body">
        {tab === 'timer' && <TimerPage />}
        {tab === 'items' && <ItemsPage />}
        {tab === 'records' && <RecordsPage />}
        {tab === 'notes' && <NotesPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      {/* 通知不可用的**常驻**降级说明：一次 toast 不足以让人知道「以后到点只在应用内提示」 */}
      {notifyIssue && (
        <p className="m-banner" role="status">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          {notifyIssue === 'denied'
            ? '系统通知权限被拒绝，到点提醒只在应用内提示'
            : '当前环境发不出系统通知，到点提醒只在应用内提示'}
        </p>
      )}

      <MobileNotice />
      <UndoToast />

      <nav className="m-tabbar" role="tablist" aria-label="主导航">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="m-tab"
            data-on={tab === id ? 'true' : 'false'}
            onClick={() => setTab(id)}
          >
            <Icon size={20} strokeWidth={iconStroke(20)} aria-hidden />
            <span className="m-tab__label">{label}</span>
          </button>
        ))}
      </nav>

      {recover && <RecoverSheet session={recover} />}
      {sheet && <SheetHost sheet={sheet} />}
    </div>
  );
}
