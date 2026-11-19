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
import type { AiTagCandidate, AiSuggestResponse } from "../../../shared/types/ai.ts";
import { aiConfigGet, aiSuggestTags } from "../../../platform/desktop/hostAiGateway.ts";
import { listTagDefinitions } from "../../../platform/persistence/tagAdminGateway.ts";
import {
  listTimingItemTags,
  listTimingItems,
} from "../../../platform/persistence/timingReadRepository.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { ClassificationService } from "../../classification/services/classificationService.ts";
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

function toAiTarget(target: AutoTagTarget) {
  return { id: target.id, text: target.text };
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

      const candidates: AiTagCandidate[] = buildTagCandidates([
        ...definitions,
        ...itemTags.flatMap((row) => row.tags),
        ...appTargets.flatMap((target) => target.existing),
      ]);
      if (candidates.length === 0) {
        onNotice?.("还没有任何标签 —— 先在上面新建一个，AI 才有地方挂", "error");
        return;
      }

      if (!configView.config.enabled) {
        /* 总开关没开时说"没启用"，而不是"标签建议已关闭" —— 后者会让人去翻那两个
           子开关，翻完还是不行（`require_ready` 先看总开关与密钥）。 */
        onNotice?.("AI 还没启用：到「设置 → AI」填好地址与密钥，再打开总开关", "error");
        return;
      }
      const { appTagsEnabled, itemTagsEnabled } = configView.config;
      let appResponse: AiSuggestResponse | null = null;
      let itemResponse: AiSuggestResponse | null = null;
      let sideErrors: string[] = [];
      /* 两侧各自受设置里的开关管（后端也会拒），所以只跑开着的那一侧——
         两开关都关着时**不报错**，只提示去哪里开：这不是 bug，是用户的选择。
         一侧失败**不丢另一侧**：网络抖一下就让整批白跑，用户只会再点一次再等一遍。 */
      if (appTagsEnabled && appTargets.length > 0) {
        try {
          appResponse = await aiSuggestTags({
            mode: "app",
            targets: appTargets.map(toAiTarget),
            candidates,
          });
        } catch (error) {
          sideErrors = [...sideErrors, `应用侧失败：${message(error)}`];
        }
      }
      if (itemTagsEnabled && itemTargets.length > 0) {
        try {
          itemResponse = await aiSuggestTags({
            mode: "item",
            targets: itemTargets.map(toAiTarget),
            candidates,
          });
        } catch (error) {
          sideErrors = [...sideErrors, `事项侧失败：${message(error)}`];
        }
      }
      if (!appResponse && !itemResponse) {
        onNotice?.(
          sideErrors.length > 0
            ? sideErrors.join("；")
            : "AI 标签建议已关闭：到「设置 → AI」打开「应用标签」或「事项标签」",
          "error",
        );
        return;
      }

      const merged = [
        ...(appResponse ? mergeSuggestions(appTargets, appResponse.suggestions) : []),
        ...(itemResponse ? mergeSuggestions(itemTargets, itemResponse.suggestions) : []),
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
