/**
 * Timing — 设置 · 数据管理 · ③ Markdown 同步（V0.11.15）
 * -----------------------------------------------------------------------------
 * 责任边界：管「写到哪 + 多久写一次 + 开不开」。
 *  - 每行（`MdSyncPathRow`）：根目录 / 选择… / 种类启用开关 / 状态 / 打开今日文件；
 *  - 自动同步间隔（5 分钟 ~ 24 小时，编号见 `mdSyncConfig`）；
 *  - 底注（模板令牌、根目录令牌、只改目标标题下的区块）。
 * **总开关不在这里**：它在块标题右侧（`MdSyncTab` 的 `actions` 槽）。
 * 理由（PRD 4.3）：总开关管的是「本地落点这一摊」，放在标题右侧与块③的内容贴在一起；
 * 云端有自己的开关（块④），两个开关管两件事。
 */
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { POLL_MAX_MINUTES, POLL_MIN_MINUTES, splitBindingError } from './mdSyncConfig';
import { MdSyncPathRow } from './MdSyncPathRow';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncLocalBlockProps {
  draft: MdSyncDraft;
}

export function MdSyncLocalBlock({ draft }: MdSyncLocalBlockProps) {
  const view = useMdSyncStore((s) => s.view);
  const { enabled, bindings, pollMin, saving, loading, loaded, error, commitPoll, updateBinding } = draft;
  const today = view?.today ?? '';
  const inline = error ? splitBindingError(error, bindings.length) : null;

  const handlePick = async (index: number) => {
    const current = bindings[index];
    if (!current) return;
    const picked = await pickFolder(
      `选择「${MD_SYNC_KIND_LABELS[current.kind]}」落点根目录`,
      current.root.includes('%') ? undefined : current.root,
    );
    if (picked) updateBinding(index, { ...current, root: picked }, 'sync');
  };

  return (
    <>
      {/* [V0.11.5] 出厂默认关：三档落点已备好，但要用户自己把总开关打开 */}
      {loaded && !enabled && (
        <p className="sync__hint">同步出厂默认关闭：把「启用 Markdown 同步」打开即可开始。</p>
      )}

      <div className="sync__interval">
        <span className="sync__label">同步间隔</span>
        <label className="num-field">
          <input
            className="num-field__input"
            type="number"
            inputMode="numeric"
            min={POLL_MIN_MINUTES}
            max={POLL_MAX_MINUTES}
            step={1}
            value={pollMin}
            aria-label="自动同步间隔（分钟）"
            title="输入分钟数后回车或点别处生效"
            /* 总开关关着时不让人调间隔：那个值此刻不会被执行，改了只会让人以为生效了 */
            disabled={saving || !enabled}
            onChange={(e) => draft.setPollMin(e.target.value)}
            onBlur={(e) => commitPoll(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPoll(e.currentTarget.value);
              }
            }}
          />
          <span className="num-field__unit">MIN</span>
        </label>
        <span className="sync__interval-hint">
          {POLL_MIN_MINUTES} 分钟 ~ {POLL_MAX_MINUTES / 60} 小时，改动后点下面的「保存并同步」
        </span>
      </div>

      {bindings.length === 0 ? (
        <p className="sync__empty">{loading ? '正在读取落点…' : '没有可同步的落点。'}</p>
      ) : (
        bindings.map((binding, index) => (
          <MdSyncPathRow
            key={`${binding.kind}-${index}`}
            binding={binding}
            status={view?.status.bindings.find((item) => item.kind === binding.kind)}
            today={today}
            disabled={saving}
            onChange={(next) => updateBinding(index, next, 'sync')}
            onPick={() => void handlePick(index)}
            onOpen={() => void draft.open(binding.kind)}
            error={inline?.index === index ? inline.text : undefined}
          />
        ))
      )}

      <p className="sync__foot">
        根目录支持 {'%APP_DIR%'}、{'%USERPROFILE%'} 与开头的 ~。
        每行只写当天的文件，两边同时改过时以 Markdown 为准。
      </p>
    </>
  );
}
