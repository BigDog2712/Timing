/**
 * Timing — 设置 · 数据管理 · ③ Markdown 同步（V0.11.15 → V0.11.16）
 * -----------------------------------------------------------------------------
 * 责任边界：管「写到哪 + 多久写一次 + 开不开」，**三行收成一行**（PRD R4）：
 *
 * ```text
 * 出厂关提示（原文不动）
 * 日记落点单框 + 今天 + 聚合状态 + 打开今日文件   ← MdSyncRootRow
 * 逐个设置（异常时才出现，点开才是三行）          ← MdSyncTierPanel
 * ```
 * [V0.11.19 批 1] 「同步间隔」整行（标签 + 数字框 + MIN + `1 分钟 ~ 24 小时`）
 * 已删除：md 同步改为事件驱动（SQL 800ms 去抖 / 外部文件 1.5s / 60s 兜底），
 * 不再有「多久跑一次」这个用户可调的量。删了就别长回来，C1 会全页零命中地查。
 *
 * **总开关不在这里**：它在块标题右侧（`MdSyncTab` 的 `actions` 槽）。理由（PRD 4.3）：
 * 总开关管的是「本地落点这一摊」，放在标题右侧与块③的内容贴在一起；云端有自己的
 * 开关（块④），两个开关管两件事。
 *
 * 本轮删掉的两段（C17/C18）：`sync__desc`「文件名与标题来自…」×3 与 `sync__foot`
 * （`%APP_DIR%` 令牌说明）。它们与块①的话重复了三次——PRD A2 要求全页零命中。
 */
import { MdSyncRootRow } from './MdSyncRootRow';
import { MdSyncTierPanel } from './MdSyncTierPanel';
import type { MdSyncDraft } from '../../services/host/useMdSyncDraft';

interface MdSyncLocalBlockProps {
  draft: MdSyncDraft;
}

export function MdSyncLocalBlock({ draft }: MdSyncLocalBlockProps) {
  const { enabled, bindings, loading, loaded } = draft;

  return (
    <>
      {/* [V0.11.5] 出厂默认关：三档落点已备好，但要用户自己把总开关打开（C15 原文不动） */}
      {loaded && !enabled && (
        <p className="sync__hint">同步出厂默认关闭：把「启用 Markdown 同步」打开即可开始。</p>
      )}

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
