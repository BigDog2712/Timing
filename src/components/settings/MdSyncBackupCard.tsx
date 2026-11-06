/**
 * Timing — 设置 · 同步 · 备份与恢复卡（V0.11.13，ADR-061）
 * -----------------------------------------------------------------------------
 * 备份是「每次覆盖前留的底」，事实全来自后端（`md_backup_list`）。恢复是破坏性操作，二次
 * 确认用页面内的确认条而不是 `window.confirm`——桌面 WebView 里它可能被拦成「什么都没发生」，
 * 用户会误以为已经恢复了。手机端整卡不渲染。
 */
import { useCallback, useEffect, useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdBackupApi } from '../../services/api';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import type { MdBackupItem } from '../../types/domain';

type KnownTarget = 'obsidian' | 'webdav' | 'folder';
type BackupGroup = { date: string | null; items: MdBackupItem[] };

const TARGET_LABELS: Record<KnownTarget, string> = { obsidian: 'Obsidian 落点', webdav: '云端落点', folder: '本地目录落点' };
const TIME = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false } as const;

function targetLabel(target: MdBackupItem['target']): string {
  return target === null ? '归属未知' : TARGET_LABELS[target];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatAt(atMs: number): string { return new Date(atMs).toLocaleString('zh-CN', TIME); }

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

export function MdSyncBackupCard() {
  /* 守卫放在外层组件：hooks 必须无条件按序调用，函数内提前 return 会打破这条规则 */
  if (IS_MOBILE) return null;
  return <BackupBody />;
}

function BackupBody() {
  const reloadView = useMdSyncStore((s) => s.load);
  const [items, setItems] = useState<MdBackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<MdBackupItem | null>(null);
  const [pickTarget, setPickTarget] = useState<KnownTarget>('obsidian');
  const [restoring, setRestoring] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await mdBackupApi.list());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const restore = async (item: MdBackupItem) => {
    setRestoring(true);
    try {
      /* 老备份（`target: null`）用确认条里选的那个；其余按文件名里的归属走 */
      const result = await mdBackupApi.restore(item.name, item.target ?? pickTarget);
      setDone(`已恢复 ${result.date} 的备份：覆盖 ${result.written} 个文件，导入 ${result.imported} 条记录`);
      setPending(null);
      await refresh();
      /* 基线与今日状态都变了：草稿接口没有刷新方法，直接走 store 的 load，
         它的回填 effect 会在 view 变化后跟上（`dirty` 时不动草稿） */
      await reloadView();
    } catch (err) {
      setError(errorText(err)); /* 失败原文照给，不吞成「恢复失败」 */
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="sync-backup">
      <header className="sync-backup__head">
        <div>
          <h3 className="sync__kind">备份与恢复</h3>
          <p className="sync__desc">每次覆盖 Markdown 前都会先留一份底；下面列出来的就是那些底。</p>
        </div>
        <button type="button" className="btn btn--ghost" disabled={loading} onClick={() => void refresh()}>刷新</button>
      </header>

      {error && <p className="sync__error">{error}</p>}
      {done && <p className="sync__ok">{done}</p>}
      {items.length === 0 && <p className="sync__empty">{loading ? '正在读取备份…' : '还没有备份。'}</p>}

      {groupByDate(items).map((group) => (
        <div key={group.date ?? 'unknown'} className="sync-backup__group">
          <h4 className="sync-backup__date">{group.date ?? '归属未知'}</h4>
          {group.items.map((item) => (
            <div key={item.name} className="sync-backup__row">
              <span className="sync-backup__target" data-target={item.target ?? 'unknown'}>
                {targetLabel(item.target)}</span>
              <span className="sync-backup__source" title={item.name}>{item.source}</span>
              <span className="sync-backup__facts">{item.date ?? '—'} · {formatBytes(item.bytes)} · {formatAt(item.atMs)}</span>
              <button type="button" className="btn btn--ghost sync-backup__go" disabled={restoring}
                onClick={() => { setDone(null); setError(null); setPickTarget('obsidian'); setPending(item); }}>
                恢复
              </button>

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
    </section>
  );
}
