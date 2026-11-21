/**
 * 数据页 · 标签管理头上的「AI 自动打标签」（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 一句话：**让 AI 把「应用」和「事项」两边的标签一次性补齐或重判**。
 *
 * ## 为什么一次管两边
 *
 * 应用标签（`__app_override::<exe>` 的 `tags`）与事项标签（`items.tags`）在库里是两套，
 * 但用户心里是同一件事："我这些东西都该归到哪些标签下"。分成两个按钮等于逼用户
 * 先想"我现在在管哪一边"——而那正是他们想交给 AI 的那部分判断。
 *
 * ## 为什么先预览、不直接写
 *
 * 写面是**全量覆盖**（应用 `override.tags`、事项 `items.tags` 都是整份替换）。
 * 直接落库意味着模型判错一次就洗掉用户手填的标签，而且要一条条改回来。
 * 所以：AI 只提议 → 清单里逐条可摘可回 → 按「应用」才写库。
 * （与 `AiCategorySuggestButton` / `AppTagDialog` 同一口径：AI 不直接动数据。）
 *
 * ## 默认勾选 = 模型建议，而不是「建议 ∪ 原有」
 *
 * 这一版的语义是"**重新判断**已有标签"：没被建议的旧标签默认落选，但会以灰色 chip
 * 显示在同一行 —— 用户看得见"哪几个要没了"，点一下就勾回来。如果默认保留旧标签，
 * 那 AI 就永远删不掉一个错标签，"重新判断"退化成"只增不减"。
 *
 * ## 谁写库
 *
 *   · 应用 → 本窗自己 `saveAppOverride`（`cmd_commit_classification_settings` 允许）；
 *   · 事项 → **只能**发 `activity:host-intent`（ACL 没给分析窗任何宿主写命令）。
 * 两条都在 `services/aiAutoTagApply.ts`，本组件只管交互。
 */
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import type { AiTagCandidate, AiTagSuggestion, AiSuggestResponse } from "../../../shared/types/ai.ts";
import { aiConfigGet, aiSuggestTags } from "../../../platform/desktop/hostAiGateway.ts";
import { listTagDefinitions } from "../../../platform/persistence/tagAdminGateway.ts";
import {
  listTimingItemTags,
  listTimingItems,
} from "../../../platform/persistence/timingReadRepository.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { ClassificationService } from "../../classification/services/classificationService.ts";
import { itemMemoryEntries, resolveLocally, type LocalHint, type MemoryEntry } from "../services/aiMemory.ts";
import {
  buildApplyPlan,
  buildTagCandidates,
  collectCreatedTags,
  defaultSelection,
  mergeSuggestions,
  rowChips,
  rowKey,
  summarizePlan,
  visibleRows,
  type AutoTagRow,
  type AutoTagTarget,
} from "../services/aiAutoTag.ts";
import {
  applyAutoTagPlan,
  persistNewTagDefinitions,
  type ApplyOutcome,
} from "../services/aiAutoTagApply.ts";

interface Props {
  /** 写完一次之后：标签树 / 走量 / 排行上的 chip 都要重读 */
  onApplied: () => void;
  onNotice?: (text: string, tone: "ok" | "error") => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 发给模型的形状。`existing` 必须带上：不带的话"重新判断"就是盲判，
 *  模型会把你手填的 `工作/周报` 换成它自己造的近义词。 */
function toAiTarget(target: AutoTagTarget) {
  return { id: target.id, text: target.text, existing: target.existing };
}

/** 本地命中的结论伪装成模型建议：后面的合并、预览、写入走同一条路，
 *  用户看到的仍是「逐条可摘」的清单，而不是静默写入。 */
function toSuggestion(hint: LocalHint): AiTagSuggestion {
  return { id: hint.id, tags: hint.tags };
}

/** 应用侧目标：先用分类页那份应用目录（**全部见过的应用**，不受数据页时间范围影响）。 */
async function loadAppTargets(): Promise<AutoTagTarget[]> {
  /* 目录冷启动时先等它加载：不等的话第一次点只有事项、第二次才有应用，
     看起来像"AI 漏了一批"。加载失败不挡事项侧（各写各的）。 */
  await ClassificationService.ensureAppCatalogLoaded().catch(() => undefined);
  const candidates = ClassificationService.getAppCatalogSnapshot().committed?.candidates ?? [];
  const seen = new Set<string>();
  const targets: AutoTagTarget[] = [];
  /* 按累计时长倒序：后端每 40 个一批顺序发，常用的先出结果；
     也让"这次打了几百个"时用户至少先看到自己最在乎的那批。 */
  const ordered = [...candidates].sort(
    (left, right) => (right.totalDuration ?? 0) - (left.totalDuration ?? 0),
  );
  for (const candidate of ordered) {
    const exeName = candidate.exeName.trim();
    if (!exeName || seen.has(exeName)) continue;
    seen.add(exeName);
    const name = candidate.appName.trim() || exeName.replace(/\.exe$/i, "");
    targets.push({
      kind: "app",
      id: exeName,
      name,
      /* 给模型看「名字 / exe」：中文名往往就是标签语义，exe 兜住同名的不同程序 */
      text: `${name} / ${exeName}`,
      existing: AppClassification.getAppTags(exeName),
    });
  }
  return targets;
}

function describe(outcome: ApplyOutcome, definitionFailures: number): string {
  const parts = [`已给 ${outcome.apps} 个应用、${outcome.items} 个事项写入标签`];
  if (outcome.failed > 0) parts.push(`${outcome.failed} 条没写进去`);
  if (definitionFailures > 0) parts.push(`${definitionFailures} 个新标签没建成定义行`);
  return parts.join("，");
}

export default function AiAutoTagButton({ onApplied, onNotice }: Props) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<AutoTagRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  /** 哪些行来自本地记忆（`kind:id`）：用来在预览里标出来源，也用来统计省下的调用。 */
  const [memoryKeys, setMemoryKeys] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [newTags, setNewTags] = useState<string[]>([]);

  const plan = useMemo(
    () => (rows ? buildApplyPlan(rows, selection) : { apps: [], items: [] }),
    [rows, selection],
  );
  const counts = summarizePlan(plan);

  const close = () => {
    setRows(null);
    setSelection({});
    setNewTags([]);
    setSkipped(0);
    setMemoryKeys(new Set());
  };

  const suggest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [appTargets, definitions, itemTags, items, configView] = await Promise.all([
        loadAppTargets(),
        listTagDefinitions(),
        listTimingItemTags(),
        listTimingItems(),
        aiConfigGet(),
      ]);
      const tagsByItem = new Map(itemTags.map((row) => [row.itemId, row.tags]));
      const itemTargets: AutoTagTarget[] = items
        .filter((item) => !item.isSystem)
        .map((item) => ({
          kind: "item",
          id: String(item.id),
          name: item.name,
          text: item.name,
          existing: tagsByItem.get(item.id) ?? [],
        }));

      /* ── 本地短路（0.12.9）───────────────────────────────────────────────
         库里历史已经能回答的那部分，不再问模型：同一个 exe 天天在用、同一类事项
         反复出现，它们的标签是"已经定过的事"，重问只会更慢更贵、还可能换成近义词。

         两条硬约束：
           1. **已有标签的一律不短路** —— 这个按钮的语义是"重新判断"，替他固定旧值
              等于让 AI 永远改不掉一个错标签；
           2. 记忆有分歧时不短路（`resolveLocally` 里按 margin 挡掉）。
         命中项仍然进预览清单、仍然可摘，只是不花 token —— 不静默写入。 */
      const memoryEntries: MemoryEntry[] = [
        ...appTargets
          .filter((target) => target.existing.length > 0)
          .map((target) => ({ text: target.name, tags: target.existing })),
        ...itemMemoryEntries(items, tagsByItem),
      ];
      /* 应用侧拿纯名字去比，不拿「名字 / exe」整串：exe 后缀会拉低所有相似度，
         让本该命中的老条目全部落选。 */
      const appLocal = resolveLocally(
        appTargets.map((target) => ({ id: target.id, text: target.name, existing: target.existing })),
        memoryEntries,
      );
      const itemLocal = resolveLocally(itemTargets, memoryEntries);
      const appAsking = new Set(appLocal.pending);
      const itemAsking = new Set(itemLocal.pending);
      const appToAsk = appTargets.filter((target) => appAsking.has(target.id));
      const itemToAsk = itemTargets.filter((target) => itemAsking.has(target.id));

      const candidates: AiTagCandidate[] = buildTagCandidates([
        ...definitions,
        ...itemTags.flatMap((row) => row.tags),
        ...appTargets.flatMap((target) => target.existing),
      ]);
      if (candidates.length === 0) {
        onNotice?.("还没有任何标签 —— 先在上面新建一个，AI 才有地方挂", "error");
        return;
      }

      /* 预检按 `require_ready` 的**同一个顺序**报缺：总开关 → 密钥。
         两种毛病补的地方不一样（卡顶的开关 / 「连接」里的密钥框），合成一句
         「填好地址与密钥，再打开总开关」会让已经填过的人去重填一遍。
         另一条更隐蔽：设置卡里的开关改的是**草稿**，不按卡片底部的「保存」就不落库
         —— 用户看着开关是开的、库里仍是关的，所以这里必须把「按保存」说出来。 */
      if (!configView.config.enabled) {
        onNotice?.(
          "AI 总开关还没打开：到「设置 → AI」拨开「启用 AI」，再按卡片底部的「保存」",
          "error",
        );
        return;
      }
      if (!configView.hasKey) {
        onNotice?.(
          "还没保存 API Key：到「设置 → AI」在「连接」里粘贴密钥，再按卡片底部的「保存」",
          "error",
        );
        return;
      }
      const { appTagsEnabled, itemTagsEnabled } = configView.config;
      let appResponse: AiSuggestResponse | null = null;
      let itemResponse: AiSuggestResponse | null = null;
      let sideErrors: string[] = [];
      /* 两侧各自受设置里的开关管（后端也会拒），所以只跑开着的那一侧——
         两开关都关着时**不报错**，只提示去哪里开：这不是 bug，是用户的选择。
         一侧失败**不丢另一侧**：网络抖一下就让整批白跑，用户只会再点一次再等一遍。
         发出去的只有 `appToAsk` / `itemToAsk`：本地记忆已经答过的那些不进请求体。 */
      if (appTagsEnabled && appToAsk.length > 0) {
        try {
          appResponse = await aiSuggestTags({
            mode: "app",
            targets: appToAsk.map(toAiTarget),
            candidates,
          });
        } catch (error) {
          sideErrors = [...sideErrors, `应用侧失败：${message(error)}`];
        }
      }
      if (itemTagsEnabled && itemToAsk.length > 0) {
        try {
          itemResponse = await aiSuggestTags({
            mode: "item",
            targets: itemToAsk.map(toAiTarget),
            candidates,
          });
        } catch (error) {
          sideErrors = [...sideErrors, `事项侧失败：${message(error)}`];
        }
      }
      const localHits = appLocal.hints.length + itemLocal.hints.length;
      /* 全部命中本地记忆时两侧都不会发请求，那不是失败 —— 那一批本来就不该花钱。 */
      if (!appResponse && !itemResponse && localHits === 0) {
        onNotice?.(
          sideErrors.length > 0
            ? sideErrors.join("；")
            : "AI 标签建议已关闭：到「设置 → AI」打开「应用标签」或「事项标签」",
          "error",
        );
        return;
      }

      /* 本地结论与模型结论走同一条合并路径：用户看到的仍是逐条可摘的清单，
         只是其中几行的来源是记忆而不是模型。 */
      const merged = [
        ...mergeSuggestions(appTargets, [
          ...appLocal.hints.map(toSuggestion),
          ...(appResponse?.suggestions ?? []),
        ]),
        ...mergeSuggestions(itemTargets, [
          ...itemLocal.hints.map(toSuggestion),
          ...(itemResponse?.suggestions ?? []),
        ]),
      ];
      const visible = visibleRows(merged);
      const failures = (appResponse?.stats.failedBatches ?? 0) + (itemResponse?.stats.failedBatches ?? 0);
      if (visible.length === 0) {
        onNotice?.(
          failures > 0 ? "AI 这批全部失败了，稍后再试一次" : "AI 没有给出可用的标签建议",
          "error",
        );
        return;
      }

      setRows(visible);
      setSkipped(merged.length - visible.length);
      setMemoryKeys(new Set([
        ...appLocal.hints.map((hint) => `app:${hint.id}`),
        ...itemLocal.hints.map((hint) => `item:${hint.id}`),
      ]));
      setNewTags(collectCreatedTags([appResponse, itemResponse].filter((row): row is AiSuggestResponse => row !== null)));
      setSelection(Object.fromEntries(visible.map((row) => [rowKey(row), defaultSelection(row)])));
      if (failures > 0) onNotice?.(`部分建议生成失败（${failures} 批），已保留成功结果`, "error");
      else if (sideErrors.length > 0) onNotice?.(`${sideErrors.join("；")}（这一侧先不写）`, "error");
    } catch (error) {
      onNotice?.(message(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (row: AutoTagRow, tag: string) => {
    const key = rowKey(row);
    setSelection((current) => {
      const picked = current[key] ?? [];
      const next = picked.includes(tag)
        ? picked.filter((value) => value !== tag)
        : [...picked, tag];
      return { ...current, [key]: next };
    });
  };

  const apply = async () => {
    if (busy || !rows) return;
    const currentPlan = buildApplyPlan(rows, selection);
    if (currentPlan.apps.length + currentPlan.items.length === 0) {
      onNotice?.("没有勾选任何对象", "error");
      return;
    }
    setBusy(true);
    try {
      const definitionFailures = await persistNewTagDefinitions(newTags);
      const outcome = await applyAutoTagPlan(currentPlan);
      close();
      onApplied();
      onNotice?.(describe(outcome, definitionFailures), outcome.failed > 0 ? "error" : "ok");
    } catch (error) {
      onNotice?.(message(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <QuietButton size="compact" busy={busy} onClick={() => void suggest()}>
        <Sparkles size={12} aria-hidden />
        AI 自动打标签
      </QuietButton>
      <QuietDialog
        open={rows !== null}
        title="AI 自动打标签"
        description="勾选要写入的标签，确认后一次落库。没被勾的既有标签会被移除 —— 灰色的是原有标签，点一下可以留下。"
        onClose={close}
        actions={(
          <>
            <QuietButton onClick={close}>取消</QuietButton>
            <QuietButton tone="primary" busy={busy} onClick={() => void apply()}>
              应用（{counts.total}）
            </QuietButton>
          </>
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 at-text-caption text-[var(--at-text-secondary)]">
          <span>建议写入：{counts.apps} 个应用 · {counts.items} 个事项</span>
          {memoryKeys.size > 0 ? (
            <span className="text-[var(--at-text-tertiary)]">
              其中 {memoryKeys.size} 条来自本地记忆，未调用模型
            </span>
          ) : null}
          {skipped > 0 ? (
            <span className="text-[var(--at-text-tertiary)]">
              另有 {skipped} 个对象 AI 没给出标签，保持不动
            </span>
          ) : null}
          {newTags.length > 0 ? (
            <span className="text-[var(--at-text-tertiary)]">
              其中 {newTags.length} 个是新标签：{newTags.join("、")}
            </span>
          ) : null}
        </div>
        <ul className="mt-3 flex max-h-[52vh] flex-col gap-2 overflow-auto pr-1">
          {(rows ?? []).map((row) => {
            const key = rowKey(row);
            const picked = selection[key] ?? [];
            return (
              <li key={key} className="flex flex-col gap-1 rounded-[10px] px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate at-text-caption text-[var(--at-text-primary)]">
                    {row.name}
                  </span>
                  <span className="shrink-0 at-text-caption text-[var(--at-text-tertiary)]">
                    {row.kind === "app" ? "应用" : "事项"}
                    {memoryKeys.has(key) ? " · 记忆" : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {rowChips(row).map((chip) => {
                    const on = picked.includes(chip.tag);
                    const removal = chip.existing && !chip.suggested;
                    return (
                      <button
                        key={chip.tag}
                        type="button"
                        className="at-tag-chip"
                        data-selected={on}
                        aria-pressed={on}
                        title={removal
                          ? `原有标签「${chip.tag}」，点一下留下（不点就会被移除）`
                          : `${on ? "移除" : "加上"}标签 #${chip.tag}`}
                        onClick={() => toggle(row, chip.tag)}
                      >
                        {on ? "✓ " : ""}#{chip.tag}
                        {removal ? <span className="at-text-caption"> （原有）</span> : null}
                      </button>
                    );
                  })}
                  {/* 全摘掉 = 清空该对象的标签。这不是错，但必须是**看得见**的选择：
                      写入是全量覆盖，一次误点会把用户手填的标签抹掉，而撤销只有手动改回来。 */}
                  {picked.length === 0 && row.existing.length > 0 ? (
                    <span className="at-text-caption text-[var(--at-danger)]">将清空原有标签</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </QuietDialog>
    </>
  );
}
