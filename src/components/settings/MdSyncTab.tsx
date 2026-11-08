/**
 * Timing — 设置 · 数据管理页签（V0.11.15 → V0.11.26，PRD 三 / 设计 §1.4）
 * -----------------------------------------------------------------------------
 * 本文件只留**壳**：标题 + 全局保存结果 + 六块挂载 + 底部 sticky 操作条。
 * 每块自己负责自己的字段与红字；状态与副作用在 `useMdSyncDraft`，数字口径在 `mdSyncConfig`，
 * 文案在 `mdSyncCopy`。
 *
 * 五条口径（改之前先看这里）：
 * 1. **六块顺序固定**：① Markdown 落点设置 → ② SQLite 落点设置 → ③ Markdown 同步 →
 *    ④ 本地同步 → ⑤ 云端同步 → ⑥ 备份数据管理。不随配置变化（PRD §4.2 / O7）。
 * 2. **三个开关，各管各的**（O8）：③ `启用 Markdown 同步`、④ `启用本地同步`、
 *    ⑤ `启用云端同步`。全页恰好 3 个 `role="switch"`，别处不许再长第四个。
 * 3. **保存入口只有一个**：底部条。② 自带的按钮保存的是**另一份东西**（数据根指针），
 *    混进「保存并同步」就再也说不清谁存了谁（PRD A6）。
 * 4. **红字只出现在出问题的那个块里**：能定位到具体落点（`第 N 个落点：…`）的原文交给
 *    块①/③ 就地显示，页签顶部只留「保存动作本身」的结果。
 * 5. **[V0.11.26] 通道分段整组删除**（PRD 变更一）：`.data__head` 之后**直接**是六块，
 *    中间没有任何「只用本地 / 本地 + 云端」控件；六块全部 `defaultOpen=false`（O4）。
 *
 * 「立即同步」在 `dirty` 时禁用：草稿里的值还没落库，按它同步一轮等于拿旧配置去跑。
 */
import { IS_MOBILE } from '../../lib/platform';
import { Switch } from '../ui/Switch';
import { FoldBlock } from './FoldBlock';
import { MdBackupSummaryLine } from './MdBackupSummaryLine';
import { MdDataRootBlock } from './MdDataRootBlock';
import { MdFormatBlock } from './MdFormatBlock';
import { MdSyncBackupCard } from './MdSyncBackupCard';
import { MdSyncLocalBlock } from './MdSyncLocalBlock';
import { MdSyncLocalCard } from './MdSyncLocalCard';
import { MdSyncWebdavCard } from './MdSyncWebdavCard';
import { COPY } from './mdSyncCopy';
import { splitBindingError } from './mdSyncConfig';
import { useBackupList } from './useBackupList';
import { useMdSyncDraft } from './useMdSyncDraft';

export function MdSyncTab() {
  const draft = useMdSyncDraft();
  /* 备份列表**只拉一次**：折叠标题下的当条记录与展开后的列表共用这一份（PRD F2） */
  const backupList = useBackupList();
  const { bindings, enabled, saving, loading, dirty, dirtyParts, error, notice } = draft;

  const blocked = saving || loading || bindings.length === 0;
  /* 能定位到某一行的原文交给块①/③，「保存动作本身」的失败才留在页签顶部 */
  const inline = error ? splitBindingError(error, bindings.length) : null;
  const globalError = error && !inline ? error : null;

  return (
    <div className="data">
      <header className="data__head">
        <h3 className="data__title">数据管理</h3>
      </header>

      {globalError && <p className="sync__error">{globalError}</p>}
      {notice && <p className="sync__ok">{notice}</p>}

      <FoldBlock id="data-format" title="Markdown 落点设置" hint={COPY.formatHint} dirty={dirtyParts.format}>
        <MdFormatBlock draft={draft} />
      </FoldBlock>

      <FoldBlock id="data-root" title="SQLite 落点设置" hint={COPY.dataRootHint}>
        <MdDataRootBlock />
      </FoldBlock>

      <FoldBlock
        id="data-sync"
        title="Markdown 同步"
        hint={COPY.syncHint}
        dirty={dirtyParts.sync}
        actions={(
          /* 总开关放标题右侧：它管的就是这一摊（PRD 4.3），两条通路各有自己的开关（④⑤） */
          <Switch checked={enabled} label="启用 Markdown 同步" disabled={saving}
            onChange={(next) => draft.setEnabled(next)} />
        )}
      >
        <MdSyncLocalBlock draft={draft} />
      </FoldBlock>

      {/* [V0.11.26] 块④ 本地同步：桌面 only（PRD R7 / O19）。手机上只有 WebDAV 一条路，
          本地目录靠电脑上的网盘客户端，手机既没有那个目录也没有客户端。 */}
      {!IS_MOBILE && (
        <FoldBlock
          id="data-local"
          title="本地同步"
          hint={COPY.localHint}
          dirty={dirtyParts.local}
          actions={(
            <Switch checked={draft.folder.enabled} label="启用本地同步" disabled={saving}
              onChange={(next) => draft.setFolderEnabled(next)} />
          )}
        >
          <MdSyncLocalCard draft={draft} />
        </FoldBlock>
      )}

      <FoldBlock
        id="data-cloud"
        title="云端同步"
        hint={COPY.cloudHint}
        dirty={dirtyParts.cloud}
        actions={(
          <Switch checked={draft.webdav.enabled} label="启用云端同步" disabled={saving}
            onChange={(next) => draft.setWebdavEnabled(next)} />
        )}
      >
        <MdSyncWebdavCard draft={draft} />
      </FoldBlock>

      <FoldBlock
        id="data-backup"
        title="备份数据管理"
        hint={COPY.backupHint}
        summary={<MdBackupSummaryLine list={backupList} />}
      >
        <MdSyncBackupCard list={backupList} />
      </FoldBlock>

      <div className="data__bar" data-dirty={dirty ? 'true' : 'false'}>
        <span className="data__bar-hint">{dirty ? '有未保存的修改' : ''}</span>
        <button type="button" className="btn btn--ghost" disabled={!dirty} onClick={draft.discard}>
          放弃修改
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={blocked || dirty}
          title={dirty ? '有未保存的修改，先保存再同步' : '按已保存的配置同步一轮'}
          onClick={() => void draft.run()}
        >
          立即同步
        </button>
        <button type="button" className="btn btn--primary" disabled={blocked} onClick={() => void draft.save()}>
          {saving ? '保存中…' : '保存并同步'}
        </button>
      </div>
    </div>
  );
}
