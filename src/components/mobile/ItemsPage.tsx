/**
 * Timing — 移动端事项页（Tab ②）
 * -----------------------------------------------------------------------------
 * 三段（PRD §4 ②）：
 *   ① 今日汇总条 —— 口径只认 `stats_summary`（`useTodayRecords` 内部就是它），
 *      条数取 `list_records` 的行数，进行中的会话额外算一条并叠加实时秒数；
 *   ② 待办区 —— 未完成全部 + 今天完成的（`lib/todoPanelLists`，与桌面 ADR-034 同源）；
 *   ③ 已完成待办 —— [V0.11.31] 今日记录**按事项合并**（同事项多段 = 一行 + 合计），
 *      并标出是否打了勾。这一页**不放「开始计时」**，也不显示分段时刻：
 *      要计时去计时页、要看流水去记录页，三处各管一件事（主人原话「应不与计时界面功能重复」）。
 *
 * 待办「开始」（与桌面同一条逻辑，用户视角「待办就是给计时的」）：
 *   - 空闲 → `todo_start`：后端按标题匹配或新建事项、开计、**当场移除待办**，
 *     前端不重复这套匹配（两份规则迟早不一致）；
 *   - 已经在计时 → 此刻要谈的不是「开始」而是「这一段怎么收尾」，弹 `todoSwitch` 选单
 *     让人选「结束并新开 / 仅改归属」（后端 `todo_start` 这时只会回 TIMER_ALREADY_RUNNING，
 *     用户体感就是「点了没反应」）。
 * 两条路径成功后都会重拉待办 store，否则那一行会留在屏幕上（PRD P0-6 的验收点）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useTodayRecords } from '../../hooks/useTodayRecords';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import { formatDuration, formatMinutes } from '../../lib/format';
import { AlertIcon, CalendarClockIcon, iconStroke } from '../../lib/icons';
import { todoPanelLists } from '../../lib/todoPanelLists';
import { groupTodayDone } from '../../lib/todayDone';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { todosActions } from '../../services/todosActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { useUiStore } from '../../stores/uiStore';
import type { Todo } from '../../types/domain';
import { DoneRow } from './DoneRow';
import { TodoRowMobile } from './TodoRowMobile';

export function ItemsPage() {
  const todos = useTodoStore((s) => s.todos);
  const todosError = useTodoStore((s) => s.error);
  const items = useItemStore((s) => s.items);
  const session = useTimerStore((s) => s.state.session);
  /* 订阅状态只为「计时中 / 已暂停」这句标记的文案（P2-5）：暂停时秒表停着，
     而移动端的恢复入口只在计时页，文案不区分就看不出来。 */
  const timerStatus = useTimerStore((s) => s.state.status);
  const liveSec = useTimerTick();
  const today = useTodayRecords();
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const setNotice = useUiStore((s) => s.setNotice);
  const recordsNonce = useMobileUiStore((s) => s.recordsNonce);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  /* 「这条待办正在开计时」的锁（P2-1 / P2-12）。用 `useRef` 而不是 `useState`：
     两次点击可能落在同一个 commit 里，那时 DOM 上挂的还是上一次 render 的 handler，
     `useState` 读到的 `starting` 是**闭包快照**（仍为 false），锁形同虚设；
     `ref.current` 是同步写入，同一同步块内连发也会被挡住。 */
  const startingRef = useRef(false);
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
  /* [V0.11.0] 事项名集合：待办「开始」走的是后端按标题匹配（或就地新建），
     标题没有同名事项时给一行灰字预告「会新建一条」，用户不会在事项列表里发现惊喜。 */
  const itemNames = useMemo(() => new Set(items.map((item) => item.name)), [items]);
  const doneRows = useMemo(
    () => groupTodayDone(today.rows, todos, (itemId) => itemName(items, itemId)),
    [today.rows, todos, items],
  );

  /* 进行中的会话不在 list_records 里（未 saved），单独一行计入条数与总时长；
     条数基准取 `stats_summary.recordCount`（汇总口径），不是明细页的行数 */
  const recordCount = today.recordCount + (session ? 1 : 0);
  const totalSec = today.totalSec + (session ? liveSec : 0);
  const activeName = itemName(items, session?.itemId ?? null);

  /* 待办「开始」的唯一接线点（待办区；已完成区不传 onStart）。
     计时状态在**点击那一刻**读：这一行只在 idle / running 之间切换时才需要不同反应，
     没必要为此让整页订阅状态（`timerStatus` 订阅是给「已暂停」文案用的，与这里无关）。 */
  const startTodo = async (todo: Todo) => {
    if (useTimerStore.getState().state.status === 'idle') {
      /* 锁只在 idle 分支里（P2-13）：真发命令的是这一支，才需要防连发。
         非 idle 要弹选单，弹选单是同步的、一条命令都不发，
         不该被「另一条待办正在开计时」挡住——否则用户点第二下界面零反馈，
         正是这次需求要消灭的「点了没反应」。 */
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        await mobileTimerActions.startTodo(todo);
      } finally {
        startingRef.current = false;
      }
      return;
    }
    openSheet({ kind: 'todoSwitch', todoId: todo.id, title: todo.title });
  };

  /* [V0.11.31] 「排时间」的入口：必须有内容才让排。
     空标题时先落库再弹面板会出现一条无标题待办（标题是必填 1-200），
     不如直接说清「先写要做什么」——那种「点了什么都没发生」最伤。 */
  const planTodo = () => {
    const title = draft.trim();
    if (!title) {
      setNotice({ tone: 'info', text: '先写要做什么，再排时间' });
      return;
    }
    openSheet({ kind: 'todoPlan', title });
  };

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
        {/* [V0.11.0] 正在计时的那一条也搬到这一屏：手机在「事项」页看不到秒表时，
            很容易以为计时没开（桌面端小条常驻，不会有这个疑问） */}
        {session && (
          <p className="m-summary__live">
            <span className="m-summary__live-dot" aria-hidden />
            <span className="m-summary__live-name">{activeName}</span>
            <span className="m-summary__live-time">{formatDuration(liveSec)}</span>
          </p>
        )}
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
          <button
            type="button"
            className="m-compose__plan"
            aria-label="排个时间"
            disabled={busy}
            onClick={planTodo}
          >
            <CalendarClockIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          </button>
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
                paused={timerStatus === 'paused'}
                /* [V0.11.0] 正在计时的那条带实时读数 */
                activeSec={session != null && todo.title === activeName ? liveSec : undefined}
                hint={itemNames.has(todo.title) ? undefined : '开始后自动建同名事项'}
                onToggle={(next) => void todosActions.toggle(todo.id, next).catch(() => undefined)}
                onStart={() => void startTodo(todo)}
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
                    /* 已完成**不传 onStart**：后端 `todo_start` 对已完成待办只会回
                       TODO_NOT_FOUND，那个按钮点了必报错。要计它先点圆圈取消完成。 */
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
          <h2 className="m-section__title">已完成待办</h2>
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
        ) : doneRows.length === 0 ? (
          <p className="m-empty">
            今天还没有做完的事。计一段时、或者勾掉一条待办，这里就会出现。
          </p>
        ) : (
          <ul className="m-list">
            {doneRows.map((row) => (
              <DoneRow
                key={row.key}
                row={row}
                onEdit={() => {
                  /* 纯待办行没有事项可编辑（`clickable` 为 false 时根本不会走到这里） */
                  if (row.itemId != null) openSheet({ kind: 'itemMenu', itemId: row.itemId });
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
