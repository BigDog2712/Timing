/**
 * TickBar — 事项窗「今日计时」记录区（V0.3.9 从容纳它的面板里拆出）
 * -----------------------------------------------------------------------------
 * 若干同名合并后的已完成行 + 一行「进行中」会话；每行右键 → 事项菜单，
 * 悬停 → 左侧便利贴预览（回调由父组件给）。
 * 拆出来的原因：`TodosPanel` 加完新增待办卡与便利贴预览后超过 300 行纪律（AGENTS.md）。
 * 顺序（V0.3.11）：已保存行按开始时间升序，**进行中的那一行排在最末**。
 * 编辑模式（V0.3.11 起，V0.3.13 改成就地打字）：记录行可改名 / 删除 / 改起止时刻
 *   —— 改名与时刻都在行内直接输入（`InlineText` / `TimeTextChip`），
 *   时刻落库走既有 `update_record`，失败就地报一行 `--danger`。
 */
import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TodayGroup } from '../../lib/todayGroups';
import { errorText } from '../../services/ipc';
import { recordApi } from '../../services/api';
import type { TimeRecord } from '../../types/domain';
import { TodosRecordRow, type RowMode } from './TodosRecordRow';

interface TodosRecordsProps {
  /** 进行中的会话；无则 null */
  session: TimeRecord | null;
  groups: TodayGroup[];
  /** 进行中行的实时秒数 */
  liveSec: number;
  itemNameOf: (itemId: number) => string;
  modeOfKey: (key: string) => RowMode;
  /** 底栏「编辑事项」 */
  editMode: boolean;
  /** 改完时刻后重拉今日数据（`useTodayRecords().reload`） */
  onReloadToday: () => void;
  /** 当前时刻（时间位跨天时预填日期） */
  now: number;
  onContextMenu: (e: ReactMouseEvent, itemId: number, key: string) => void;
  /** 请求删除确认（内联条） */
  onRequestDelete: (key: string, itemId: number) => void;
  onHoverStart: (itemId: number) => (e: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverEnd: () => void;
  onSubmitRename: (itemId: number, name: string) => void;
  onCancelEdit: () => void;
  onConfirmDelete: (itemId: number) => void;
  /** [V0.4.2] 点记录行 = 直接开始这一条事项的计时（用户口径「点击事项可以直接开始计时」） */
  onActivate: (itemId: number) => void;
}

export function TodosRecords({
  session,
  groups,
  liveSec,
  itemNameOf,
  modeOfKey,
  editMode,
  onReloadToday,
  now,
  onContextMenu,
  onRequestDelete,
  onHoverStart,
  onHoverEnd,
  onSubmitRename,
  onCancelEdit,
  onConfirmDelete,
  onActivate,
}: TodosRecordsProps) {
  const [timeError, setTimeError] = useState<string | null>(null);

  /** 改某条记录的开始 / 结束时刻（`update_record` 自带 `ended >= started` 校验） */
  const commitTime = (recordId: number, field: 'start' | 'end', ms: number) => {
    void (async () => {
      try {
        setTimeError(null);
        await recordApi.update(recordId, field === 'start' ? { startedAt: ms } : { endedAt: ms });
        onReloadToday();
      } catch (err) {
        setTimeError(errorText(err));
      }
    })();
  };

  return (
    <div className="todos__records">
      {groups.map((group) => {
        /* [V0.4.2] key 用 group.key：同一事项按连续性拆成多行，`grp-{name}` 会撞 */
        const key = group.key;
        return (
          <TodosRecordRow
            key={key}
            name={group.name}
            startedAt={group.startedAt}
            endedAt={group.endedAt}
            seconds={group.seconds}
            count={group.count}
            status="done"
            editMode={editMode}
            now={now}
            startRecordId={group.firstId}
            endRecordId={group.lastId}
            onCommitTime={commitTime}
            onTimeError={setTimeError}
            mode={modeOfKey(key)}
            onContextMenu={(e) => onContextMenu(e, group.itemId, key)}
            onRequestDelete={() => onRequestDelete(key, group.itemId)}
            onHoverStart={onHoverStart(group.itemId)}
            onHoverEnd={onHoverEnd}
            onSubmitRename={(name) => onSubmitRename(group.itemId, name)}
            onCancelEdit={onCancelEdit}
            onConfirmDelete={() => onConfirmDelete(group.itemId)}
            onActivate={() => onActivate(group.itemId)}
          />
        );
      })}
      {/* 进行中放最后：时间序上它就是最新开始的那条 */}
      {session && (
        <TodosRecordRow
          name={itemNameOf(session.itemId)}
          startedAt={session.startedAt}
          seconds={liveSec}
          status="running"
          editMode={editMode}
          now={now}
          onCommitTime={commitTime}
          onTimeError={setTimeError}
          mode={modeOfKey(`live-${session.id}`)}
          onContextMenu={(e) => onContextMenu(e, session.itemId, `live-${session.id}`)}
          onRequestDelete={() => onRequestDelete(`live-${session.id}`, session.itemId)}
          onHoverStart={onHoverStart(session.itemId)}
          onHoverEnd={onHoverEnd}
          onSubmitRename={(name) => onSubmitRename(session.itemId, name)}
          onCancelEdit={onCancelEdit}
          onConfirmDelete={() => onConfirmDelete(session.itemId)}
        />
      )}
      {timeError && <p className="todos__err">{timeError}</p>}
    </div>
  );
}
