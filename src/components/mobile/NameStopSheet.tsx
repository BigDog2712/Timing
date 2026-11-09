/**
 * Timing — 结束「未命名计时」后补名字（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 主人原话：「支持未命名事件直接计时……不过在结束计时时，应让用户填入事项名称」。
 *
 * 为什么是"结束后"而不是"开始前"：想按一下就开始的人，最不想做的就是先在一堆事项里挑
 * 一个。先记时长、结束后补名字，两个动作都只需要一下。
 *
 * 三条口径（都不在这里重新发明）：
 *   1. **先找再建**：`matchItemByName` 走全等匹配，避免「写周报」被建成两条；
 *   2. **只改归属**：`recordApi.update` 的 patch 只带 `itemId`，起止时间与备注原样不动；
 *   3. **可以拒绝**：底部「先不命名」直接关，这条继续挂「未归类」——这是合法的结局，
 *      不是失败（所以不进提示条、不弹红字）。
 *
 * 常用 / 最近用过的选项做成一行胶囊：90% 的情况用户要的就是其中一件，
 * 点一下即记账并关闭，连输入框都不用碰。
 */
import { useState } from 'react';
import { formatClockTime, formatDuration } from '../../lib/format';
import { RECENT_ITEMS_DEFAULT, pinnedItems, recentItems } from '../../lib/moyu';
import { NAME_MAX_LEN, matchItemByName, normalizeName } from '../../lib/unnamed';
import { errorText, itemApi, recordApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useUiStore } from '../../stores/uiStore';
import type { Item, TimeRecord } from '../../types/domain';
import { Sheet } from './Sheet';

interface NameStopSheetProps {
  record: TimeRecord;
}

/** 快捷项上限：再多就要滚，而滚一行胶囊比打字还慢 */
const QUICK_MAX = 6;

/** 常用 + 最近，去重、去掉系统事项（那条就是"不命名"本身）。 */
function quickItems(items: readonly Item[]): Item[] {
  const seen = new Set<number>();
  const out: Item[] = [];
  for (const item of [...pinnedItems(items), ...recentItems(items, RECENT_ITEMS_DEFAULT)]) {
    if (item.isSystem || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= QUICK_MAX) break;
  }
  return out;
}

export function NameStopSheet({ record }: NameStopSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const bumpRecords = useMobileUiStore((s) => s.bumpRecords);
  const items = useItemStore((s) => s.items);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const quick = quickItems(items);

  /** 把这段记到某个事项名下；`itemId` 为 null 时用输入框里的名字（先找同名的，找不到再建）。 */
  const assign = async (itemId: number | null) => {
    if (busy) return;
    const title = normalizeName(name);
    if (itemId == null && title.length === 0) {
      setError('写个名字，或者点下面的「先不命名」');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let targetId = itemId;
      if (targetId == null) {
        const existing = matchItemByName(useItemStore.getState().items, title);
        if (existing) {
          targetId = existing.id;
        } else {
          const created = await itemApi.create({ name: title });
          targetId = created.id;
          /* 建完必须 reload，否则下一屏的事项列还是旧的 */
          await useItemStore.getState().reload();
        }
      }
      await recordApi.update(record.id, { itemId: targetId });
      bumpRecords();
      useUiStore.getState().setNotice({ text: '名字已记上', tone: 'info' });
      closeSheet('nameStop');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="这段时间在做什么？"
      onClose={() => closeSheet('nameStop')}
      footer={
        <div className="m-sheet__foot-row">
          <button type="button" className="m-btn m-btn--small" onClick={() => closeSheet('nameStop')}>
            先不命名
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary m-field--grow"
            disabled={busy}
            onClick={() => void assign(null)}
          >
            保存名字
          </button>
        </div>
      }
    >
      <p className="m-name__sum">
        {formatDuration(record.accumulatedSec)} · 从 {formatClockTime(record.startedAt)} 开始
      </p>

      <input
        className="m-input"
        value={name}
        maxLength={NAME_MAX_LEN}
        placeholder="比如：写周报"
        onChange={(e) => setName(e.target.value)}
        aria-label="这段时间在做什么"
        /* 自动聚焦：这一屏的唯一目的就是让人敲字（或点一个胶囊） */
        autoFocus
      />

      {quick.length > 0 && (
        <>
          <p className="m-name__label">或者直接点一个</p>
          <div className="m-name__chips">
            {quick.map((item) => (
              <button
                key={item.id}
                type="button"
                className="m-btn m-btn--small m-name__chip"
                disabled={busy}
                onClick={() => void assign(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}

      <p className="m-hint">不命名也没关系，这一段会留在「未归类」里，随时能在记录页改归属。</p>
    </Sheet>
  );
}
