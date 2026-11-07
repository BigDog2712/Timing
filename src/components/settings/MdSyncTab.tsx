/**
 * Timing — 设置 · 数据管理页签（V0.11.15，PRD 三 / 设计 §5）
 * -----------------------------------------------------------------------------
 * 本文件只留**壳**：标题 + 一句总览 + 全局保存结果 + 五块挂载 + 底部 sticky 操作条。
 * 每块自己负责自己的字段与红字；状态与副作用在 `useMdSyncDraft`，数字口径在 `mdSyncConfig`。
 *
 * 三条口径（改之前先看这里）：
 * 1. **五块顺序固定**：① Markdown 落点设置 → ② SQLite 落点设置 → ③ Markdown 同步 →
 *    ④ WebDAV 云端同步 → ⑤ 备份数据管理。不随配置变化（PRD A2）。
 * 2. **保存入口只有一个**：底部条。五块里只有 ② 自带按钮（打开文件夹 / 更改位置…），
 *    因为它保存的是**另一份东西**（数据根指针），混进「保存并同步」就再也说不清谁存了谁
 *    （PRD A6）。这是「改了不知道去哪保存」的唯一防线，别加第二个保存按钮。
 * 3. **红字只出现在出问题的那个块里**：能定位到具体落点（`第 N 个落点：…`）的原文交给
 *    块①/③ 就地显示，页签顶部只留「保存动作本身」的结果。
 *
 * 「立即同步」在 `dirty` 时禁用：草稿里的值还没落库，按它同步一轮等于拿旧配置去跑。
 */
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { Switch } from '../ui/Switch';
import { FoldBlock } from './FoldBlock';
import { MdDataRootBlock } from './MdDataRootBlock';
import { MdFormatBlock } from './MdFormatBlock';
import { MdSyncBackupCard } from './MdSyncBackupCard';
import { MdSyncCloudCard } from './MdSyncCloudCard';
import { MdSyncLocalBlock } from './MdSyncLocalBlock';
import { clampMinutes, describeInterval, splitBindingError } from './mdSyncConfig';
import { useMdSyncDraft } from './useMdSyncDraft';

export function MdSyncTab() {
  const draft = useMdSyncDraft();
  /* 落点的运行状态与「今天」不属于草稿（草稿只管用户能改的东西），直接读视图 */
  const today = useMdSyncStore((s) => s.view?.today ?? '');
  const { bindings, enabled, saving, loading, dirty, dirtyParts, cloudConfigured, error, notice } = draft;

  const blocked = saving || loading || bindings.length === 0;
  /* 能定位到某一行的原文交给块①/③，「保存动作本身」的失败才留在页签顶部 */
  const inline = error ? splitBindingError(error, bindings.length) : null;
  const globalError = error && !inline ? error : null;

  return (
    <div className="data">
      <header className="data__head">
        <h3 className="data__title">数据管理</h3>
        <p className="data__hint">
          从上到下五块：写成什么样 → 数据库放哪 → 多久写一次 → 云端第二份 → 备份。
          改完点最下面的「保存并同步」。
        </p>
      </header>

      {globalError && <p className="sync__error">{globalError}</p>}
      {notice && <p className="sync__ok">{notice}</p>}

      <FoldBlock
        id="data-format"
        title="Markdown 落点设置"
        hint="管「写成什么样」：每个种类的文件模板与标题行。放哪个目录在第三块里改。"
        dirty={dirtyParts.format}
      >
        <MdFormatBlock draft={draft} />
      </FoldBlock>

      <FoldBlock
        id="data-root"
        title="SQLite 落点设置"
        hint="数据库、日志、备份与 Markdown 出厂落点所在的目录。改位置会先复制、再核对、最后写指针。"
      >
        <MdDataRootBlock />
      </FoldBlock>

      <FoldBlock
        id="data-sync"
        title="Markdown 同步"
        hint={`默认每 ${describeInterval(clampMinutes(draft.pollMin))}自动对齐一次；两边同时改过时，以 Markdown 为准。`}
        dirty={dirtyParts.sync}
        actions={(
          /* 总开关放标题右侧：它管的就是这一摊（PRD 4.3），云端有自己的开关（块④） */
          <Switch checked={enabled} label="启用 Markdown 同步" disabled={saving}
            onChange={(next) => draft.setEnabled(next)} />
        )}
      >
        <MdSyncLocalBlock draft={draft} />
      </FoldBlock>

      <FoldBlock
        id="data-cloud"
        title="WebDAV 云端同步"
        hint="把今天的 Markdown 再送一份到坚果云或本地目录。没配过时默认收起。"
        dirty={dirtyParts.cloud}
        /* 没配过云端（`cloud === null`）的人不必先看六个空输入框（PRD 三） */
        defaultOpen={cloudConfigured}
      >
        <MdSyncCloudCard draft={draft} />
      </FoldBlock>

      <FoldBlock
        id="data-backup"
        title="备份数据管理"
        hint="每次覆盖 Markdown 前留的底：可以直接用系统默认程序打开看，也可以恢复。"
      >
        <MdSyncBackupCard />
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

      <p className="data__note">
        {today ? `今天：${today}。` : ''}
        同步只改目标标题下的区块，日记其他内容不动。
      </p>
    </div>
  );
}
