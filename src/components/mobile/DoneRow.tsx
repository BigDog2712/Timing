/**
 * Timing — 事项页「已完成待办」的一行（V0.11.31）
 * -----------------------------------------------------------------------------
 * 从 `ItemsPage` 拆出来（行数门禁），顺便让这一行的口径写在自己的文件里：
 *   - 名称 + 勾选态 + 合计时长三列，**没有**「开始计时」按钮，也不显示分段时刻
 *     （主人原话「应不与计时界面功能重复」）；
 *   - 纯待办（没绑事项）的行不可点：没有事项可编辑，做成按钮只会是「点了没反应」。
 */
import { formatDuration } from '../../lib/format';
import { CheckIcon, EmptyDotIcon, iconStroke } from '../../lib/icons';
import type { TodayDoneRow } from '../../lib/todayDone';

export interface DoneRowProps {
  row: TodayDoneRow;
  /** 点行 = 打开事项编辑（[V0.11.30] 主人口径：「点按事项后应唤起编辑界面」） */
  onEdit: () => void;
}

/**
 * 单行「今天做完的事」：名称 + 勾选态 + 合计时长。
 *
 * [V0.11.31] 去掉了上一版加的行尾「▶ 开始」与长按：主人要的是「不与计时界面功能重复」，
 * 而计时入口在计时页（以及换事项面板）本来就有两个，这一页再放一个只会制造第三个口径。
 */
export function DoneRow({ row, onEdit }: DoneRowProps) {
  /* 纯待办（没绑事项）没有事项可编辑：点它不做事，也不该把手感做成「点了没反应」的按钮，
     所以那种行不给 onClick，只保留静态文字。 */
  const clickable = row.itemId != null;
  const body = (
    <>
      <span className="m-done__name">
        {row.name}
        {row.count > 1 && <span className="m-record__count">×{row.count} 段</span>}
      </span>
      <span className="m-done__flag" data-on={row.checked ? 'true' : 'false'}>
        {row.checked ? (
          <>
            <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            已完成
          </>
        ) : (
          <>
            <EmptyDotIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            未勾选
          </>
        )}
      </span>
      <span className="m-record__dur">{row.count > 0 ? formatDuration(row.seconds) : '—'}</span>
    </>
  );
  return (
    <li>
      {clickable ? (
        <button type="button" className="m-done" onClick={onEdit}>
          {body}
        </button>
      ) : (
        <div className="m-done">{body}</div>
      )}
    </li>
  );
}
