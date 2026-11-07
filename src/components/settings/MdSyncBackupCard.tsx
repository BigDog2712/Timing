/**
 * Timing — 设置 · 同步 · 备份与恢复卡（V0.11.13 → V0.11.16）
 * -----------------------------------------------------------------------------
 * 备份是「每次覆盖前留的底」，事实全来自后端（`md_backup_list`）。恢复是破坏性操作，二次
 * 确认用页面内的确认条而不是 `window.confirm`——桌面 WebView 里它可能被拦成「什么都没发生」，
 * 用户会误以为已经恢复了。手机端整卡不渲染。
 *
 * [V0.11.15] 变成块⑤的**正文**（`<section>` / `<header>` 交给 `FoldBlock`），每行新增
 * 「打开」：用系统默认程序打开那份 `.md`。打开失败（文件已被删、系统没有 .md 关联）
 * **必须原文就地显示**——用 `rawIpcText` 而不是 `errorText()`，后者会把 `IO_ERROR`
 * 润色成「系统调用失败，请重试」，用户就再也看不到「文件不存在：obsidian__2026-11-05.md」
 * 这句话了（PRD D2）。
 *
 * [V0.11.16] **不再自己拉列表**：改吃 `list` prop（`useBackupList` 是唯一数据源）。
 * 否则「折叠标题下显示当条记录」就得在设置页发两条一模一样的 `md_backup_list`，
 * 而且两次结果可能不同——一件写成两件事。body 头部那句说明（C22）也删了：
 * 它与折叠标题下的 C21 重复。
 */
import { useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { mdBackupApi, rawIpcText } from '../../services/api';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import type { MdBackupItem } from '../../types/domain';
import { TARGET_LABELS, formatAtShort, type KnownTarget, targetLabel } from './mdBackupFacts';
import { formatBytes } from './mdSyncConfig';
import type { MdBackupList } from './useBackupList';

type BackupGroup = { date: string | null; items: MdBackupItem[] };

/** 按 `date` 分组（`null` 归「归属未知」组并排最后），组内按 `atMs` 倒序 */
function groupByDate(items: MdBackupItem[]): BackupGroup[] {
  const buckets = new Map<string, MdBackupItem[]>();
  for (const item of items) {
    const key = item.date ?? '';
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const groups = [...buckets.entries()].map(([key, list]) => ({
    date: key === '' ? null : key, items: [...list].sort((a, b) => b.atMs - a.atMs),
  }));
  return groups.sort((a, b) => (a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1));
}

interface MdSyncBackupCardProps {
  /** 备份列表的单一数据源（`MdSyncTab` 调一次 `useBackupList`，两处共用） */
  list: MdBackupList;
}

export function MdSyncBackupCard({ list }: MdSyncBackupCardProps) {
  /* 守卫放在外层组件：hooks 必须无条件按序调用，函数内提前 return 会打破这条规则 */
  if (IS_MOBILE) return null;
  return <BackupBody list={list} />;
}

function BackupBody({ list }: MdSyncBackupCardProps) {
  const reloadView = useMdSyncStore((s) => s.load);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<MdBackupItem | null>(null);
  const [pickTarget, setPickTarget] = useState<KnownTarget>('obsidian');
  const [restoring, setRestoring] = useState(false);
  /* 「打开」的失败原文按备份名存：红字要落在**那一行**，不能糊在列表顶上 */
  const [openError, setOpenError] = useState<{ name: string; text: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const restore = async (item: MdBackupItem) => {
    setRestoring(true);
    try {
      /* 老备份（`target: null`）用确认条里选的那个；其余按文件名里的归属走 */
      const result = await mdBackupApi.restore(item.name, item.target ?? pickTarget);
      setDone(`已恢复 ${result.date} 的备份：覆盖 ${result.written} 个文件，导入 ${result.imported} 条记录`);
      setPending(null);
      await list.refresh();
      /* 基线与今日状态都变了：草稿接口没有刷新方法，直接走 store 的 load，
         它的回填 effect 会在 view 变化后跟上（`dirty` 时不动草稿） */
      await reloadView();
    } catch (err) {
      setFailure(rawIpcText(err)); /* 失败原文照给，不吞成「恢复失败」 */
    } finally {
      setRestoring(false);
    }
  };

  /* 用系统默认程序打开这份备份。失败原因原文照给（`rawIpcText`），不吞成「打开失败」 */
  const open = async (item: MdBackupItem) => {
    setOpening(item.name);
    setOpenError(null);
    setDone(null);
    try {
      await mdBackupApi.open(item.name);
    } catch (err) {
      setOpenError({ name: item.name, text: rawIpcText(err) });
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <div className="sync-backup__head">
        <button type="button" className="btn btn--ghost" disabled={list.loading}
          onClick={() => void list.refresh()}>刷新</button>
      </div>

      {list.error && <p className="sync__error">{list.error}</p>}
      {failure && <p className="sync__error">{failure}</p>}
      {done && <p className="sync__ok">{done}</p>}
      {list.items.length === 0 && (
        <p className="sync__empty">{list.loading ? '正在读取备份…' : '还没有备份。'}</p>
      )}

      {groupByDate(list.items).map((group) => (
        <div key={group.date ?? 'unknown'} className="sync-backup__group">
          <h4 className="sync-backup__date">{group.date ?? '归属未知'}</h4>
          {group.items.map((item) => (
            <div key={item.name} className="sync-backup__row">
              <span className="sync-backup__target" data-target={item.target ?? 'unknown'}>
                {targetLabel(item.target)}</span>
              <span className="sync-backup__source" title={item.name}>{item.source}</span>
              {/* [QA F4] 时间格式与折叠摘要行**同一个函数**（`formatAtShort`）：
                  首版这里是 `2026/11/07 22:14`、摘要行是 `11-07 22:14`，同一页面两种格式。 */}
              <span className="sync-backup__facts">{item.date ?? '—'} · {formatBytes(item.bytes)} · {formatAtShort(item.atMs)}</span>
              <button type="button" className="btn btn--ghost sync-backup__open"
                disabled={opening === item.name} onClick={() => void open(item)}>
                {opening === item.name ? '打开中…' : '打开'}
              </button>
              <button type="button" className="btn btn--ghost sync-backup__go" disabled={restoring}
                onClick={() => { setDone(null); setFailure(null); setOpenError(null); setPickTarget('obsidian'); setPending(item); }}>
                恢复
              </button>

              {openError?.name === item.name && <p className="sync__error">{openError.text}</p>}

              {pending?.name === item.name && (
                <div className="sync-backup__confirm">
                  <p className="sync-backup__confirm-text">
                    会用这份备份覆盖当前文件。覆盖前会自动把当前内容再留一份底，恢复本身不会让你再丢一次。
                  </p>
                  {item.target === null && (
                    <div className="seg seg--compact" role="group" aria-label="恢复到哪个落点">
                      {(['obsidian', 'webdav'] as KnownTarget[]).map((value) => (
                        <button key={value} type="button" className="seg__item" onClick={() => setPickTarget(value)}
                          data-on={pickTarget === value ? 'true' : 'false'} aria-pressed={pickTarget === value}>
                          {TARGET_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="sync-backup__confirm-actions">
                    <button type="button" className="btn btn--ghost" disabled={restoring}
                      onClick={() => setPending(null)}>取消</button>
                    <button type="button" className="btn btn--danger" disabled={restoring}
                      onClick={() => void restore(item)}>{restoring ? '恢复中…' : '确认恢复'}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
