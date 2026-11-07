/**
 * Timing — 设置 · 数据管理 · ③ Markdown 同步（V0.11.15 → V0.11.16）
 * -----------------------------------------------------------------------------
 * 责任边界：管「写到哪 + 多久写一次 + 开不开」，**三行收成一行**（PRD R4）：
 *
 * ```text
 * 出厂关提示（原文不动）
 * 同步间隔（数字 + MIN + C16 短句）
 * 日记落点单框 + 今天 + 聚合状态 + 打开今日文件   ← MdSyncRootRow
 * 逐个设置（异常时才出现，点开才是三行）          ← MdSyncTierPanel
 * ```
 *
 * **总开关不在这里**：它在块标题右侧（`MdSyncTab` 的 `actions` 槽）。理由（PRD 4.3）：
 * 总开关管的是「本地落点这一摊」，放在标题右侧与块③的内容贴在一起；云端有自己的
 * 开关（块④），两个开关管两件事。
 *
 * 本轮删掉的两段（C17/C18）：`sync__desc`「文件名与标题来自…」×3 与 `sync__foot`
 * （`%APP_DIR%` 令牌说明）。它们与块①的话重复了三次——PRD A2 要求全页零命中。
 */
import { COPY } from './mdSyncCopy';
import { POLL_MAX_MINUTES, POLL_MIN_MINUTES } from './mdSyncConfig';
import { MdSyncRootRow } from './MdSyncRootRow';
import { MdSyncTierPanel } from './MdSyncTierPanel';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncLocalBlockProps {
  draft: MdSyncDraft;
}

export function MdSyncLocalBlock({ draft }: MdSyncLocalBlockProps) {
  const { enabled, bindings, pollMin, saving, loading, loaded, commitPoll } = draft;

  return (
    <>
      {/* [V0.11.5] 出厂默认关：三档落点已备好，但要用户自己把总开关打开（C15 原文不动） */}
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
        {/* C16：从「1 分钟 ~ 1440 分钟，改动后点下面的『保存并同步』」压成这一句 */}
        <span className="sync__interval-hint">{COPY.intervalNote}</span>
      </div>

      {bindings.length === 0 ? (
        <p className="sync__empty">{loading ? '正在读取落点…' : '没有可同步的落点。'}</p>
      ) : (
        <>
          <MdSyncRootRow draft={draft} />
          <MdSyncTierPanel draft={draft} />
        </>
      )}
    </>
  );
}
