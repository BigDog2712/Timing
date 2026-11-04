/**
 * Timing — 移动端事项页（Tab ②）
 * -----------------------------------------------------------------------------
 * 三段（PRD §4 ②）：
 *   ① 今日汇总条 —— 口径只认 `stats_summary`（`useTodayRecords` 内部就是它），
 *      条数取 `list_records` 的行数，进行中的会话额外算一条并叠加实时秒数；
 *   ② 待办区 —— 未完成全部 + 今天完成的（`lib/todoPanelLists`，与桌面 ADR-034 同源）；
 *   ③ 今日记录 —— 按事项 + 时间连续性合并（`lib/todayGroups`），**点行 = 开始这一条**，
 *      长按 = 事项菜单（停止计时 / 编辑 / 归档 / 删除）。
 *
 * 待办「开始」走 `todo_start`：后端按标题匹配事项并**当场移除待办**，
 * 所以这里必须重拉待办 store，否则那一行会留在屏幕上（PRD P0-6 的验收点）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useLongPress } from '../../hooks/useLongPress';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useTodayRecords } from '../../hooks/useTodayRecords';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import { formatDuration, formatMinutes, formatRange } from '../../lib/format';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { todoPanelLists } from '../../lib/todoPanelLists';
import { groupTodayRecords, type TodayGroup } from '../../lib/todayGroups';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { todosActions } from '../../services/todosActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { TodoRowMobile } from './TodoRowMobile';

interface RecordRowProps {
  group: TodayGroup;
  onTap: () => void;
  onLongPress: () => void;
}

/** 单行今日记录：点 = 开始这一条，长按 = 事项菜单（hook 不能写在 map 里，故独立成组件） */
function RecordRow({ group, onTap, onLongPress }: RecordRowProps) {
  const press = useLongPress(onLongPress, onTap);
  return (
    <li>
      <div className="m-record" {...press}>
        <span className="m-record__name">
          {group.name}
          {group.count > 1 && <span className="m-record__count">×{group.count}</span>}
        </span>
        <span className="m-record__range">{formatRange(group.startedAt, group.endedAt)}</span>
        <span className="m-record__dur">{formatDuration(group.seconds)}</span>
      </div>
    </li>
  );
}

export function ItemsPage() {
  const todos = useTodoStore((s) => s.todos);
  const todosError = useTodoStore((s) => s.error);
  const items = useItemStore((s) => s.items);
  const session = useTimerStore((s) => s.state.session);
  const liveSec = useTimerTick();
  const today = useTodayRecords();
  const timerActions = useTimerActions();
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const recordsNonce = useMobileUiStore((s) => s.recordsNonce);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  /* 逾期判定基准每分钟刷新一次；不需要高频 tick */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useTodoStore.getState().reload().catch(() => undefined);
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* 记录被编辑 / 删除 / 撤销（记录页发同一个自增信号）后，今日记录与汇总条要重拉：
     两处读的是同一份 `list_records`，否则撤销完这里还挂着那条已不存在的记录。 */
  const reloadToday = today.reload;
  useEffect(() => {
    if (recordsNonce > 0) reloadToday();
  }, [recordsNonce, reloadToday]);

  const { pending, done } = useMemo(() => todoPanelLists(todos, now), [todos, now]);
  const groups = useMemo(
    () => groupTodayRecords(today.rows, (itemId) => itemName(items, itemId)),
    [today.rows, items],
  );

  /* 进行中的会话不在 list_records 里（未 saved），单独一行计入条数与总时长；
     条数基准取 `stats_summary.recordCount`（汇总口径），不是明细页的行数 */
  const recordCount = today.recordCount + (session ? 1 : 0);
  const totalSec = today.totalSec + (session ? liveSec : 0);
  const activeName = itemName(items, session?.itemId ?? null);

  const createTodo = async () => {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await todosActions.create(title);
      setDraft('');
    } catch {
      /* 失败提示由 store 的 error 字段落到下方错误行，不必再弹一条 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-items">
      <section className="m-summary">
        <div className="m-summary__main">
          <span className="m-summary__label">今日计时</span>
          <strong className="m-summary__count">{recordCount} 条</strong>
        </div>
        <span className="m-summary__total">{formatMinutes(totalSec)}</span>
      </section>

      <section className="m-section">
        <header className="m-section__head">
          <h2 className="m-section__title">待办</h2>
          <span className="m-section__meta">{pending.length} 项</span>
        </header>

        <div className="m-compose">
          <input
            className="m-input m-field--grow"
            value={draft}
            maxLength={TODO_TITLE_MAX_CHARS}
            placeholder="添加一条待办…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTodo();
            }}
          />
          <button type="button" className="m-btn m-btn--primary" disabled={!draft.trim() || busy} onClick={() => void createTodo()}>
            添加
          </button>
        </div>

        {todosError && (
          <p className="m-error" role="alert">
            <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            {todosError}
          </p>
        )}

        {pending.length === 0 ? (
          <p className="m-empty">还没有待办。加一条，点「开始」直接进入计时。</p>
        ) : (
          <ul className="m-list">
            {pending.map((todo) => (
              <TodoRowMobile
                key={todo.id}
                todo={todo}
                now={now}
                active={session != null && todo.title === activeName}
                onToggle={(next) => void todosActions.toggle(todo.id, next).catch(() => undefined)}
                onStart={() => void mobileTimerActions.startTodo(todo.id)}
                onDelete={() => todosActions.remove(todo.id)}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <>
            <button type="button" className="m-more" onClick={() => setShowDone((v) => !v)}>
              {showDone ? '收起已完成' : `已完成 ${done.length} 条`}
            </button>
            {showDone && (
              <ul className="m-list">
                {done.map((todo) => (
                  <TodoRowMobile
                    key={todo.id}
                    todo={todo}
                    now={now}
                    onToggle={(next) => void todosActions.toggle(todo.id, next).catch(() => undefined)}
                    onStart={() => void mobileTimerActions.startTodo(todo.id)}
                    onDelete={() => todosActions.remove(todo.id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="m-section">
        <header className="m-section__head">
          <h2 className="m-section__title">今日记录</h2>
          <button type="button" className="m-link" onClick={() => useMobileUiStore.getState().setTab('records')}>
            看全部
          </button>
        </header>

        {today.error ? (
          <div className="m-error" role="alert">
            <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            <span>{today.error}</span>
            <button type="button" className="m-btn m-btn--small" onClick={today.reload}>
              重试
            </button>
          </div>
        ) : today.loading ? (
          <p className="m-empty">正在读取今日记录…</p>
        ) : groups.length === 0 ? (
          <p className="m-empty">今天还没有记录。回到计时页点一下开始。</p>
        ) : (
          <ul className="m-list m-list--record">
            {groups.map((group) => (
              <RecordRow
                key={group.key}
                group={group}
                onTap={() => void timerActions.startOrSwitch(group.itemId)}
                onLongPress={() => openSheet({ kind: 'itemMenu', itemId: group.itemId })}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
