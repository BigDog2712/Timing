/**
 * Timing — 设置 · 数据管理 · ② 的「更改位置」（V0.11.15，设计 §3.3 / §5.2）
 * -----------------------------------------------------------------------------
 * 责任边界：选目录 → 把「要搬什么」摊开给人看 → 确认 → 执行 → 交回新的 info。
 * 预检（非空 / 同上 / 祖先后代 / 不可写 / 空间不足）**全在 Rust 里**，本文件不复写判据：
 * 失败时后端给的那句话（`rawIpcText` 原文）就是用户唯一的行动依据，就地显示，不进复制。
 *
 * 为什么不用 `window.confirm`：桌面 WebView 里它可能被拦成「什么都没发生」，用户会以为
 * 已经改好了（备份卡踩过同一个坑，见 `MdSyncBackupCard` 的页面内确认条）。
 */
import { useState } from 'react';
import { dataRootApi, rawIpcText } from '../../services/api';
import { pickFolder } from '../../services/folderPicker';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { formatBytes } from './mdSyncConfig';

interface MdDataRootChangeProps {
  /** 当前快照：五项清单与旧目录都从这里来（不自己拼路径、不自己算体积） */
  info: DataRootInfo;
  onCancel: () => void;
  /** 成功：父级用返回的快照刷新（`pending` 此刻是新目录 = 待重启生效） */
  onDone: (next: DataRootInfo) => void;
}

export function MdDataRootChange({ info, onCancel, onDone }: MdDataRootChangeProps) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const picked = await pickFolder('选择新的数据目录（会把这五项复制过去）', info.current);
    if (!picked) return; /* 用户取消：保留原状态，什么都不改 */
    setTarget(picked);
    setError(null);
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await dataRootApi.change(target));
    } catch (err) {
      /* 预检拒绝 / 复制失败 / 核对不一致，全是 `IO_ERROR` + 原文（设计 §9-5） */
      setError(rawIpcText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data__confirm">
      {target === null ? (
        <>
          <p className="data__note">
            选一个空文件夹（没有就新建一个）。确认后会把下面这五项复制过去，重启 Timing 才生效。
          </p>
          <div className="data__confirm-actions">
            <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
            <button type="button" className="btn btn--neutral" onClick={() => void pick()}>
              选择目录…
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="data__note">
            将把这五项复制到
            <br />
            <code>{target}</code>
          </p>
          <ul className="data__entries">
            {info.entries.map((entry) => (
              <li key={entry.name} className="data__entry">
                <span className="data__entry-name">{entry.name}{entry.isDir ? '\\' : ''}</span>
                {/* `present: false` = 「没有这一项」，不是「0 B 的空文件」 */}
                <span className="data__entry-size">
                  {entry.present ? formatBytes(entry.bytes) : '没有这一项'}
                </span>
              </li>
            ))}
          </ul>
          <p className="data__note">
            合计 {formatBytes(info.sizeBytes)}。旧目录 {info.current} 不会删除，
            重启后确认没问题再自己删。
          </p>
          {error && <p className="sync__error">{error}</p>}
          <div className="data__confirm-actions">
            <button type="button" className="btn btn--ghost" disabled={busy}
              onClick={() => setTarget(null)}>换一个目录</button>
            <button type="button" className="btn btn--primary" disabled={busy}
              onClick={() => void confirm()}>
              {busy ? '正在复制…' : '确认复制并切换'}
            </button>
          </div>
        </>
      )}

      {target === null && error && <p className="sync__error">{error}</p>}
    </div>
  );
}
