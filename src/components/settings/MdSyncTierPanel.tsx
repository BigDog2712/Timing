/**
 * Timing — 设置 · 数据管理 · ③ 的「逐个设置」出口（V0.11.16，PRD 4.4 / 设计 §3.3）
 * -----------------------------------------------------------------------------
 * 本轮把块③的三行收成一行（PRD R4），代价是三个**档位开关**会一起消失——这不是可以
 * 忽略的副作用，是必须留出口的不减功能点（R12/D5）：
 *
 * ```text
 * 任一档 enabled === false      → 「便利贴这一档已关闭同步。」      + 「逐个设置」
 * 三档 root 不全相同            → 「三档落点不同：…」                + 「逐个设置」
 * 两者都不成立                  → 什么都不出现（新装用户看不到任何多余的东西）
 * ```
 *
 * ## 展开态存哪（坑 2 的答案）
 *
 * **组件局部 `useState`，不进草稿**。三条理由：
 * 1. 它**不落库**，进草稿就污染 `dirty` 语义：用户点开看一眼就被标「未保存」；
 * 2. `useMdSyncDraft` 的回填 effect 依赖 `[view, dirty]`，展开态混进去会被后台同步
 *    事件反复重置（用户正看着三个输入框，面板自己合上了）；
 * 3. 局部 state 让 `MdSyncPathRow` 的「按需挂载」成立：收起时**根本不渲染**那三行
 *    （不是 `hidden`），于是删掉 `sync__desc` 之后这三行不会在任何折叠态文本里被搜到。
 *
 * ## 提示行与展开态的关系（不许「刚点开就消失」）
 *
 * 触发条件在用户把三档改回一致后消失，但面板**不会自己收起来**：`open` 是用户的动作，
 * 只有用户能撤销（底部那颗「收起逐个设置」）。
 *
 * ## 唯一的例外：后端校验失败时自动展开
 *
 * 逐档的红字（`第 N 个落点：…`）只画在 `MdSyncPathRow` 里。若面板收着而不展开，这条
 * 红字就**谁都看不见**——「保存失败但没有提示」比「面板自己弹开」糟得多。
 */
import { useState } from 'react';
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { CLOSED_TIER_SUFFIX, mixedRootNote, mixedRootTitle } from './mdSyncCopy';
import { splitBindingError } from './mdSyncConfig';
import { differingBindings, disabledKinds } from './mdSyncShared';
import { MdSyncPathRow } from './MdSyncPathRow';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncTierPanelProps {
  draft: MdSyncDraft;
}

export function MdSyncTierPanel({ draft }: MdSyncTierPanelProps) {
  const view = useMdSyncStore((s) => s.view);
  const [open, setOpen] = useState(false);
  const today = view?.today ?? '';
  const { bindings, saving, error, updateBinding } = draft;
  const inline = error ? splitBindingError(error, bindings.length) : null;
  /* 有落点级红字时必须展开，否则它只画在下面那三行里、谁也看不到 */
  const expanded = open || inline !== null;

  const closed = disabledKinds(bindings);
  const differing = differingBindings(bindings, 'root');
  const note = closed.length > 0
    ? `${closed.map((kind) => MD_SYNC_KIND_LABELS[kind]).join('、')}${CLOSED_TIER_SUFFIX}`
    : differing.length > 0
      ? mixedRootNote(differing)
      : null;
  /* 行内放不下就截断，全文进 `title`（三个 Obsidian 长路径并列会把一行撑成两行半） */
  const title = closed.length > 0 ? note ?? undefined : mixedRootTitle(differing);

  const handlePick = async (index: number) => {
    const current = bindings[index];
    if (!current) return;
    const picked = await pickFolder(
      `选择「${MD_SYNC_KIND_LABELS[current.kind]}」落点根目录`,
      current.root.includes('%') ? undefined : current.root,
    );
    /* 逐档手改：`updateBinding` 会顺手作废 `root` 的统一意图（否则保存时的扇出覆盖它） */
    if (picked) updateBinding(index, { ...current, root: picked }, 'sync');
  };

  if (!expanded) {
    if (!note) return null;
    return (
      <div className="sync__tier-hint">
        <span className="sync__tier-text" title={title}>{note}</span>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
          逐个设置
        </button>
      </div>
    );
  }

  return (
    <>
      {bindings.map((binding, index) => (
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
      ))}
      <button type="button" className="btn btn--ghost sync__tier-close" onClick={() => setOpen(false)}>
        收起逐个设置
      </button>
    </>
  );
}
