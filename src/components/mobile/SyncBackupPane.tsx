/**
 * Timing — 移动端「数据管理 · 备份与恢复」（V0.11.22）
 * -----------------------------------------------------------------------------
 * 桌面上那张卡（`settings/MdSyncBackupCard`）在 v0.11.21 之前对手机是**整卡不渲染**的，
 * 后端 `md_backup_*` 也一律回「请在电脑上操作」。这一轮把它搬上来。
 *
 * ## 恢复是什么（别当成「恢复出厂」）
 *
 * 「备份」是每次同步覆盖用户日记**之前**留的底（`infra::md_backup`）。恢复 = 用那份内容
 * 覆盖回去：写回文件 **+** 把记录 / 便利贴 / 待办导入回 SQL。所以它是**对 SQL 数据的还原**，
 * 主人这一轮要的正是这个（「参考桌面端，是对 sql 数据进行管理」）。
 *
 * ## 三条纪律
 *
 * 1. **二次确认**：恢复是覆盖写，第一次点「恢复」只展开确认条（写明覆盖范围），
 *    第二次点「确认恢复」才发命令。桌面同一套（`MdSyncBackupCard` 的 confirm 条）；
 * 2. **手机上只认云端那份**：`webdav__` 才有落点。`obsidian__` / 老备份不给按钮，
 *    只留一句说明——按钮点了必失败的东西不该出现在界面上。真正的拒绝仍在后端
 *    （`services::md_backup::restorable_on_mobile`），前端只是不摆假希望；
 * 3. **失败给原文**：`rawIpcText()` 不吞成「恢复失败」——「落点没配好」与「文件读不出来」
 *    是两句完全不同的行动指令。
 */
import { useCallback, useEffect, useState } from 'react';
import type { MdBackupItem } from '../../types/domain';
import { rawIpcText } from '../../services/api';
import { mobileNative } from '../../services/mobileNative';

const TARGET_LABELS: Record<string, string> = {
  webdav: '云端',
  obsidian: '电脑本地',
  folder: '本地目录',
};

function targetLabel(item: MdBackupItem): string {
  if (item.target === null) return '归属未知';
  return TARGET_LABELS[item.target] ?? item.target;
}

/** 手机上有没有落点可写。判据与后端同一条：只有 `webdav`。 */
function restorable(item: MdBackupItem): boolean {
  return item.target === 'webdav';
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function atText(atMs: number): string {
  return new Date(atMs).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SyncBackupPane() {
  const [list, setList] = useState<MdBackupItem[] | null>(null);
  const [pending, setPending] = useState<MdBackupItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  /* 失败原文按备份名存：红字要落在**那一条**，不能糊在列表顶上 */
  const [failure, setFailure] = useState<{ name: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await mobileNative.backupList());
    } catch (err) {
      setFailure({ name: '', text: rawIpcText(err) });
      setList([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item: MdBackupItem) => {
    setBusy(true);
    setDone('');
    setFailure(null);
    try {
      const result = await mobileNative.backupRestore(item.name);
      setDone(`已恢复 ${result.date} 的备份：导入 ${result.imported} 条记录，覆盖 ${result.written} 个文件`);
      setPending(null);
      /* 恢复会再留一份底，列表要跟着刷新（新底排在最前） */
      await load();
    } catch (err) {
      setFailure({ name: item.name, text: rawIpcText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting-group">
      <div className="setting-row">
        <span className="setting-row__label">备份与恢复</span>
      </div>
      <p className="m-hint">
        每次覆盖日记前都会留一份底。恢复会用那份内容覆盖现在的记录，覆盖前再留一份底，
        所以恢复本身不会让你再丢一次。
      </p>

      {list === null && <p className="m-hint">正在读取备份…</p>}
      {list !== null && list.length === 0 && (
        <p className="m-hint">还没有备份。第一次把数据写进云端文件之后才会出现。</p>
      )}

      {list !== null && list.length > 0 && (
        <ul className="m-backup">
          {list.map((item) => (
            <li className="m-backup__row" key={item.name} data-backup-name={item.name}>
              <div className="m-backup__main">
                <span className="m-backup__date">{item.date ?? item.source}</span>
                <span className="m-backup__meta">
                  {targetLabel(item)} · {atText(item.atMs)} · {sizeText(item.bytes)}
                </span>
              </div>
              {restorable(item) ? (
                <button
                  type="button"
                  className="m-btn m-btn--small"
                  disabled={busy}
                  onClick={() => {
                    setDone('');
                    setFailure(null);
                    setPending(item);
                  }}
                >
                  恢复
                </button>
              ) : (
                <span className="m-backup__off">手机上恢复不了</span>
              )}

              {failure?.name === item.name && <p className="m-backup__error">{failure.text}</p>}
              {pending?.name === item.name && (
                <div className="m-backup__confirm">
                  <p>
                    会用这份备份覆盖当前内容：今天及以前的记录 / 便利贴 / 待办回到留底那一刻。
                    覆盖前会自动把现在的内容再留一份底。
                  </p>
                  <div className="m-cloud__actions">
                    <button
                      type="button"
                      className="m-btn m-btn--primary"
                      disabled={busy}
                      onClick={() => void restore(item)}
                    >
                      {busy ? '恢复中…' : '确认恢复'}
                    </button>
                    <button
                      type="button"
                      className="m-btn m-btn--small"
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {done && <p className="m-hint" data-backup-result="done">{done}</p>}
      {failure?.name === '' && <p className="m-backup__error">{failure.text}</p>}
    </div>
  );
}
