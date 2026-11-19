/**
 * AI 自动打标签 · 写入层（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 只做"把 `buildApplyPlan` 的结果落到两套写面上"，不含任何 UI 与 AI 调用。
 *
 * ## 为什么两套写面不能合并
 *
 * | | 应用 | 事项 |
 * |---|---|---|
 * | 存在哪 | `__app_override::<exe>` 的 `tags` 字段 | `items.tags`（JSON 数组） |
 * | 谁能写 | 分析窗自己（`cmd_commit_classification_settings`） | **只有药丸**（`set_item_tags`） |
 * | 归一 | `normalizeAppTags`（12 个上限，前端） | 后端 `normalize` |
 *
 * 事项那侧走 `activity:host-intent` 事件桥是**结构决定的**，不是风格选择：
 * `permissions/activity-host-tags.toml` 的边界写死"分析窗没有任何宿主写命令"，
 * 逐条写事项标签一直在药丸侧执行（见该文件顶部注释）。
 *
 * ## 失败为什么逐条吞
 *
 * 一条批量动作里有 80 个事项，其中 1 个写失败（事项刚好被删）不该让另外 79 个回滚 ——
 * 这里没有事务，也不该装作有。所以每条独立 try/catch，把成功/失败计数回给 UI，
 * 由它报一句"79 条已写、1 条没写进去"。**不静默**：计数必须被展示。
 */
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import { ClassificationService } from "../../classification/services/classificationService.ts";
import { createTagDefinition } from "../../../platform/persistence/tagAdminGateway.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import type { AutoTagPlan } from "./aiAutoTag.ts";

export interface ApplyOutcome {
  /** 应用侧真正落库条数 */
  apps: number;
  /** 事项侧真正发出去（≠ 宿主写成功，这条通道没有回执）的意图条数 */
  items: number;
  /** 失败的条数：应用是写异常，事项是意图没发出去 */
  failed: number;
}

/**
 * 给模型新建的标签补一张定义行（`tag.def.*`）。
 *
 * 为什么必须补：`set_item_tags` 只改 `items.tags`，**不建定义行**。不补的话，
 * 这些新标签只跟着当前这一条记录存在 —— 用户改天把那条事项的标签删掉，
 * 整条路径就从标签树里消失，看起来像"AI 建过的标签自己没了"。
 *
 * 失败不挡写入：定义行只服务"没有引用也要存在"的那部分；写不进去最多是这条
 * 标签在树里暂时看不见，不该导致整批打标签失败。
 */
export async function persistNewTagDefinitions(paths: readonly string[]): Promise<number> {
  let failed = 0;
  for (const path of paths) {
    try {
      await createTagDefinition(path);
    } catch {
      failed += 1;
    }
  }
  return failed;
}

/**
 * 应用侧：逐条覆盖 `override.tags`。
 *
 * **只改 `tags`**（与 `AppTagDialog` 同一口径）：`category` / `categories` 是老数据的
 * 读路径，标签路径（`娱乐/燕云`）不是合法分类键，塞进去会被 `normalizeAppOverride` 丢掉。
 * 展开 `current` 而不是只写 `{ tags }`：`track` / `captureTitle` / `displayName` 这些
 * 用户设置不能因为打了一次标签就被清空。
 */
export async function applyAppAutoTags(
  entries: AutoTagPlan["apps"],
): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const current: AppOverride | null = AppClassification.getUserOverride(entry.exeName);
      await ClassificationService.saveAppOverride(entry.exeName, {
        ...(current ?? {}),
        tags: entry.tags,
      });
      applied += 1;
    } catch {
      failed += 1;
    }
  }
  return { applied, failed };
}

/**
 * 事项侧：逐条发意图。
 *
 * `emitHostIntent` 的返回值是"**发出去了**"，不是"宿主写成了" —— 这条通道没有回执。
 * 所以这里只把"没发出去"算失败，写入失败由药丸侧的 `setNotice` 呈现（§6.5 跨窗只传意图）。
 */
export async function applyItemAutoTags(
  entries: AutoTagPlan["items"],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const entry of entries) {
    const ok = await emitHostIntent({ action: "set_item_tags", itemId: entry.itemId, tags: entry.tags });
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 两套写面一起跑，汇总成一个 `ApplyOutcome`。顺序固定：先应用、后事项。 */
export async function applyAutoTagPlan(plan: AutoTagPlan): Promise<ApplyOutcome> {
  const apps = await applyAppAutoTags(plan.apps);
  const items = await applyItemAutoTags(plan.items);
  return {
    apps: apps.applied,
    items: items.sent,
    failed: apps.failed + items.failed,
  };
}
