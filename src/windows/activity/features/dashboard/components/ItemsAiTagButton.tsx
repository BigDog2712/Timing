/**
 * 合并卡「事项」·上区的 **AI 一键分类**（0.12.6 · T4）
 * =============================================================================
 * 一颗按钮 + 一层预览。三件事按顺序发生，**顺序本身就是需求**：
 *
 *   1. 只挑 `tags.length === 0` 的事项 —— 已打标的**不参与**（P0-6「已带标签的事项不被覆盖」）；
 *   2. 先把 AI 的建议铺开给人看，逐条可摘；**取消 = 一条都不写**（零写入）；
 *   3. 按「应用」才落库，落完报条数，并留一个「撤销本次分类」。
 *
 * ## 为什么不复用 `features/data` 的 `AiAutoTagButton`
 *
 * 那个管的是**应用 + 事项全量重判**：它的口径是"模型重新判断已有标签"，默认勾选 =
 * 建议（旧标签默认落选）。本卡的语义相反 —— 只补空白、绝不动已有的。共用一个组件就得
 * 在里面加一堆 `mode` 分支，两套口径迟早互相污染。所以只复用**纯逻辑与写入层**
 * （`aiAutoTag.ts` / `aiAutoTagApply.ts`），交互自己写。
 *
 * ## 写库仍然只有一条路
 *
 * 分析窗没有 `set_item_tags`（`permissions/activity-host-tags.toml` 的边界），所有写入都是
 * `applyItemAutoTags` → `emitHostIntent({action:'set_item_tags'})` → 药丸用 `tagApi.set` 落库。
 * 本文件**不** invoke，也不自己拼事件。
 *
 * ## 撤销为什么是"写回空数组"，以及它的**边界**
 *
 * `set_item_tags` 是**整份覆盖**，不是增量：撤销发的是 `tags: []`，把这批事项的标签整体
 * 写成空。它能还原，只因为入口筛的是 `tags.length === 0` —— 参与分类的事项在分类前本来就
 * 没有标签，"清空"恰好等于"分类前状态"。这比缓存旧标签简单，也不会因为缓存过时而写回
 * 一份更旧的快照。
 *
 * 但它**不是**"只撤掉 AI 写的那一份"：从「应用」到点撤销之间，用户在别处给这批里某条
 * 手动加上的标签，也会被一起清掉（本轮不做逐条 diff 撤销，批次历史见 P2-2）。
 * 这是"整份覆盖"的必然结果，不是实现失误 —— 所以撤销键带 `itemsAiTagUndoHint`
 * 把代价写在 `title`/`aria-label` 里：按钮上只有四个字，代价却是不可逆的。
 * 只保留**最近一次**（P2-2 的"按批次保留历史、可重复回滚一次"留到下一轮）。
 */
import { useEffect, useMemo, useState } from "react";

import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToastPush } from "../../../shared/types/toast.ts";
import { aiConfigGet, aiSuggestTags } from "../../../platform/desktop/hostAiGateway.ts";
import { listTagDefinitions } from "../../../platform/persistence/tagAdminGateway.ts";
import { listTimingItemTags } from "../../../platform/persistence/timingReadRepository.ts";
import {
  buildApplyPlan,
  buildTagCandidates,
  collectCreatedTags,
  mergeSuggestions,
  rowChips,
  rowKey,
  summarizePlan,
  visibleRows,
  type AutoTagPlan,
  type AutoTagRow,
  type AutoTagTarget,
} from "../../data/services/aiAutoTag.ts";
import { itemMemoryEntries, pickExamples, resolveLocally } from "../../data/services/aiMemory.ts";
import { applyItemAutoTags, persistNewTagDefinitions } from "../../data/services/aiAutoTagApply.ts";
import { TIMELINE_MANAGE_COPY } from "../copyTimeline.ts";
import type { ItemPrefsLike } from "../services/itemPrefs.ts";

interface Props {
  /** 上区当前的事项清单（`useItemPrefs` 已经取过一份，这里不重复 `list_items`） */
  items: readonly ItemPrefsLike[];
  /** 写完一次之后：上区清单与下区行上的标签标记都要重读 */
  onApplied: () => void;
  onToast: ToastPush;
}

/** 撤销要记住的那一条：只要 id 与名字（名字只用来给提示条留个可读的痕）。 */
interface UndoEntry {
  itemId: number;
  name: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_PLAN: AutoTagPlan = { apps: [], items: [] };

export default function ItemsAiTagButton({ items, onApplied, onToast }: Props) {
  const copy = TIMELINE_MANAGE_COPY[useLocale()];
  const UI_TEXT = useLocaleText();

  /** 已经有标签的事项 id（`null` = 还没读到：此时不判空态，也不许点） */
  const [taggedIds, setTaggedIds] = useState<ReadonlySet<number> | null>(null);
  /** AI 可用（总开关 + 密钥 + 事项侧开关）。任何一项缺 → 按钮置灰 + 说清缺什么 */
  const [aiReady, setAiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<AutoTagRow[] | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [newTags, setNewTags] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  /** 本地记忆直接给出答案的条数（它们没有进请求体，也就没有花 token） */
  const [memoryHits, setMemoryHits] = useState(0);
  const [undo, setUndo] = useState<UndoEntry[] | null>(null);

  /* 挂载时读一次：标签（算"哪些事项还没打标"）+ AI 配置（决定能不能点）。
     两条都并发、都不阻塞渲染 —— 读不到就按"没有标签 / 不可用"处理，
     按钮置灰并说原因，绝不把整张卡打红。 */
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listTimingItemTags(), aiConfigGet()]).then(([tagsResult, configResult]) => {
      if (cancelled) return;
      const tagged = new Set<number>();
      if (tagsResult.status === "fulfilled") {
        for (const row of tagsResult.value) if (row.tags.length > 0) tagged.add(row.itemId);
      }
      setTaggedIds(tagged);
      if (configResult.status === "fulfilled") {
        const view = configResult.value;
        setAiReady(view.config.enabled && view.hasKey && view.config.itemTagsEnabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 还没打标的事项 = 候选全集。系统事项（未归类）永不参与。 */
  const untagged = useMemo(() => {
    if (taggedIds === null) return [];
    return items.filter((item) => !item.isSystem && !taggedIds.has(item.id));
  }, [items, taggedIds]);

  /* 置灰理由的优先级：没事项可分类 > 没配好 AI。前者更常发生，也更接近用户此刻的疑惑。
     两条都用 `aria-disabled` 而不是 `disabled` —— 禁用会丢焦点，而这里**点了要能说话**。 */
  const disabledReason = untagged.length === 0
    ? copy.itemsAiTagNothing
    : !aiReady
      ? copy.itemsAiTagNoConfig
      : null;

  const included = useMemo(
    () => (rows ?? []).filter((row) => !excluded.has(rowKey(row))),
    [rows, excluded],
  );
  const plan = useMemo(() => {
    if (!rows) return EMPTY_PLAN;
    const selection: Record<string, string[]> = {};
    for (const row of included) selection[rowKey(row)] = [...row.suggested];
    return buildApplyPlan(rows, selection);
  }, [rows, included]);
  const counts = summarizePlan(plan);

  const close = (): void => {
    setRows(null);
    setExcluded(new Set());
    setNewTags([]);
    setSkipped(0);
    setMemoryHits(0);
  };

  const suggest = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      /* 点的时候**重读**一次标签：上区清单可能是几分钟前拉的，中间用户可能在别处打过标。
         重读的另一个好处是把"有没有可分类的事项"这一刻的事实，而不是挂载那一刻的。 */
      const [definitions, tagRows] = await Promise.all([listTagDefinitions(), listTimingItemTags()]);
      const byItem = new Map<number, string[]>(tagRows.map((row) => [row.itemId, row.tags]));
      setTaggedIds(new Set(tagRows.filter((row) => row.tags.length > 0).map((row) => row.itemId)));

      const targets: AutoTagTarget[] = items
        .filter((item) => !item.isSystem && (byItem.get(item.id)?.length ?? 0) === 0)
        .map((item) => ({
          kind: "item",
          id: String(item.id),
          name: item.name,
          text: item.name,
          existing: [],
        }));
      if (targets.length === 0) {
        onToast(copy.itemsAiTagNothing, "info");
        return;
      }
      /* 候选表里也要带上事项身上已有的标签：那些路径是"树里现在真的存在"的，
         不让模型用它就会去新造一堆近义标签。 */
      const candidates = buildTagCandidates([...definitions, ...tagRows.flatMap((row) => row.tags)]);
      if (candidates.length === 0) {
        onToast(copy.itemsAiTagNoCandidates, "warning");
        return;
      }

      /* 记忆：本入口只收**空白事项**，所以"已打过标的事项"天然就是最好的例子 ——
         它们与待判项同属一个事项树，命名习惯一致。`targets` 本身没有标签，不会被收进
         记忆库，不必再传排除集。 */
      const memoryEntries = itemMemoryEntries(items, byItem);

      /* ── 本地短路（0.12.9）───────────────────────────────────────────────
         这个入口只收 `existing: []` 的事项，正好是短路最安全的地方：没有旧标签要保，
         命中直接用；判错的代价与"多调一次模型"同级（仍需用户在预览里确认）。
         命中项照样进清单、照样能勾掉 —— 不是静默写入。 */
      const local = resolveLocally(targets, memoryEntries);
      const asking = new Set(local.pending);
      const toAsk = targets.filter((target) => asking.has(target.id));

      const response = toAsk.length > 0
        ? await aiSuggestTags({
          mode: "item",
          targets: toAsk.map((target) => ({
            id: target.id,
            text: target.text,
            /* 本入口只收空白事项，`existing` 恒为空数组 —— 仍然显式给，
               是为了和"这条没有标签"与"我不知道它有没有"区分开（形状一致，语义明确）。 */
            existing: target.existing,
          })),
          candidates,
          /* 例子只从**真正要问的**那几条里挑：全量算一遍会把已短路的项也带进来，
             白算，还可能挤掉更像的例子。 */
          examples: pickExamples(toAsk.map((target) => target.text), memoryEntries),
        })
        : null;

      /* 本地结论与模型结论走同一条合并路径：预览里仍是逐条清单，只是来源不同。 */
      const merged = mergeSuggestions(targets, [
        ...local.hints.map((hint) => ({ id: hint.id, tags: hint.tags })),
        ...(response?.suggestions ?? []),
      ]);
      const visible = visibleRows(merged);
      if (visible.length === 0) {
        onToast(copy.itemsAiTagNoSuggestion, "warning");
        return;
      }
      setRows(visible);
      setExcluded(new Set());
      setSkipped(merged.length - visible.length);
      setMemoryHits(local.hints.length);
      setNewTags(collectCreatedTags(response ? [response] : []));
    } catch (error) {
      /* AI 失败 / 超时：报错、原标签不变（这里根本没写），可重试，不产生半截数据 */
      onToast(message(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = (key: string): void => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = async (): Promise<void> => {
    if (busy || !rows) return;
    if (plan.items.length === 0) {
      onToast(copy.itemsAiTagNothingSelected, "warning");
      return;
    }
    setBusy(true);
    try {
      /* 顺序不能反：先补定义行，再写引用。反过来的话中途失败会留下"引用存在、定义不存在"
         的悬空标签 —— 标签树里看不见它，但事项上挂着它。 */
      await persistNewTagDefinitions(newTags);
      const outcome = await applyItemAutoTags(plan.items);
      /* 本地把"这几条已经有标签了"记上：不记的话按钮会一直认为它们还是空白，
         用户再点一次会拿到一份空计划（多一次 AI 往返、多一次困惑）。 */
      setTaggedIds((current) => {
        const next = new Set(current ?? []);
        for (const entry of plan.items) {
          if (entry.tags.length > 0) next.add(entry.itemId);
          else next.delete(entry.itemId);
        }
        return next;
      });
      const names = new Map(rows.map((row) => [row.id, row.name]));
      setUndo(
        plan.items
          .filter((entry) => entry.tags.length > 0)
          .map((entry) => ({ itemId: entry.itemId, name: names.get(String(entry.itemId)) ?? "" })),
      );
      close();
      onApplied();
      onToast(copy.itemsAiTagResult(outcome.sent, outcome.failed), outcome.failed > 0 ? "error" : "success");
    } catch (error) {
      onToast(message(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const undoAll = async (): Promise<void> => {
    if (busy || !undo || undo.length === 0) return;
    setBusy(true);
    try {
      const outcome = await applyItemAutoTags(undo.map((entry) => ({ itemId: entry.itemId, tags: [] })));
      setUndo(null);
      onApplied();
      onToast(copy.itemsAiTagUndone(outcome.sent), outcome.failed > 0 ? "error" : "success");
    } catch (error) {
      onToast(message(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 动作组里的第四颗：与「新增 / 编辑 / 事项管理」同一档（`at-link-btn`），
          置灰时仍然可点 —— 点了会说一句"为什么现在不能点"。 */}
      <button
        type="button"
        className="at-link-btn at-items-zone-ai"
        aria-disabled={disabledReason !== null || busy ? true : undefined}
        title={disabledReason ?? undefined}
        onClick={() => {
          if (disabledReason !== null) {
            onToast(disabledReason, "warning");
            return;
          }
          void suggest();
        }}
      >
        {busy ? copy.itemsAiTagBusy : copy.itemsAiTag}
      </button>

      {/* 撤销只保留最近一次：再打完一批，上一批就不可撤销（P2-2 的批次历史留到下一轮）。
          `title` / `aria-label` 说的是**后果**（整份覆盖，会连手动加的标签一起清掉）：
          这两处是唯一能在点下去之前看到代价的地方。
          `aria-label` 以可见文字开头，读屏念出来的名字仍包含按钮上那几个字（WCAG 2.5.3）。 */}
      {undo && undo.length > 0 ? (
        <button
          type="button"
          className="at-link-btn at-items-zone-undo"
          title={copy.itemsAiTagUndoHint}
          aria-label={copy.itemsAiTagUndoHint}
          onClick={() => void undoAll()}
        >
          {copy.itemsAiTagUndo}
        </button>
      ) : null}

      <QuietDialog
        open={rows !== null}
        title={copy.itemsAiTagPreviewTitle}
        description={copy.itemsAiTagPreviewDesc}
        onClose={close}
        actions={(
          <>
            <QuietButton onClick={close}>{UI_TEXT.dialog.cancel}</QuietButton>
            <QuietButton tone="primary" busy={busy} onClick={() => void apply()}>
              {copy.itemsAiTagApply(counts.items)}
            </QuietButton>
          </>
        )}
      >
        <div className="at-items-ai-summary">
          <span>{copy.itemsAiTagApply(counts.items)}</span>
          {memoryHits > 0 ? <span>{copy.itemsAiTagMemory(memoryHits)}</span> : null}
          {skipped > 0 ? <span>{copy.itemsAiTagSkippedRows(skipped)}</span> : null}
        </div>
        <ul className="at-items-ai-list">
          {(rows ?? []).map((row) => {
            const key = rowKey(row);
            const on = !excluded.has(key);
            return (
              <li key={key} className="at-items-ai-row" data-excluded={!on || undefined}>
                <input
                  type="checkbox"
                  className="at-items-ai-check"
                  checked={on}
                  aria-label={`${copy.itemsAiTagSkipRow}：${row.name}`}
                  onChange={() => toggleRow(key)}
                />
                <div className="at-items-ai-body">
                  <span className="at-items-ai-name" title={row.name}>{row.name}</span>
                  {/* 建议标签只读展示：这条链路的粒度是"整条要不要写"，不是"删掉其中一个标签"。
                      逐 chip 摘除在"本来就有旧标签"的场景才有意义（本入口只收空白事项）。 */}
                  <span className="at-items-ai-tags">
                    {rowChips(row).map((chip) => (
                      <span key={chip.tag} className="at-tag-chip" data-selected="true">#{chip.tag}</span>
                    ))}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </QuietDialog>
    </>
  );
}
