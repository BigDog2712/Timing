/**
 * 旧「应用分类」页（单值）→ 新表候选集（多值）的单向同步。
 *
 * ## 为什么必须有这一步
 *
 * 切片只读 `app_category`（`resolve_child_category` 的两条规则）。而旧页保存走的是
 * `__app_override::<exe>` 里的 `category` 单值。不同步的后果：用户在旧页把 chrome
 * 改成「游戏」，切片仍按上一轮的候选集算 —— 界面上改了、数据没变，**零报错**，
 * 而且用户会以为「分类功能坏了」。
 *
 * ## 方向为什么是单向（旧 → 新）
 *
 * 旧页的语义就是「设成这一个」：候选集被压成一条，规则 2 必然返回它，与旧的强制覆盖
 * 行为一致 —— 所以这里不需要再引入一条「强制覆盖」规则（设计文档 §4.1 反对的就是
 * 「两条规则打架时无人能判」）。
 *
 * 反过来（新 → 旧）不做：新面板配了 `[学习, 游戏]` 之后，旧页读出来的还是它自己那份
 * 单值。这是**显示**上的陈旧，不是数据分叉 —— 切片只认新表。
 *
 * ## 失败为什么不抛出
 *
 * 保存动作本身已经成功（KV 写完了）。这里失败只会让「旧页显示的分类」与「切片实际用的
 * 分类」不一致，而这一致性在打开新面板时立刻可见（面板以库为准）。为了派生数据把
 * 用户那次保存报成失败，比不一致本身更糟。
 */
import {
  listAppCategories,
  removeAppCategory,
  setAppCategory,
} from "../../../platform/persistence/attributionGateway.ts";
import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";

/**
 * 一个 override 对应的候选集（0 或 1 条）。纯函数，给测试直接调。
 *
 * 入参只要 `category` / `enabled` 两个字段 —— 不写 `AppOverride`：这个函数关心的是
 * 「这条 override 到底有没有分类」，而 `displayName` / `color` 那些字段与候选集无关，
 * 收窄之后测试也不必为它们造桩值。
 */
export function candidateKeysForOverride(
  override: { category?: string | null; enabled?: boolean } | null | undefined,
): string[] {
  if (!override || override.enabled === false) return [];
  const category = override.category?.trim();
  return category ? [category] : [];
}

/** 把某个应用的候选集同步成 `targets`（顺序即 priority，步长 10）。 */
export async function syncCandidates(appKey: string, targets: readonly string[]): Promise<void> {
  const canonical = resolveCanonicalExecutable(appKey);
  if (!canonical) return;
  try {
    const existing = await listAppCategories(canonical);
    for (const row of existing) {
      if (!targets.includes(row.categoryKey)) {
        await removeAppCategory(canonical, row.categoryKey);
      }
    }
    for (const [index, categoryKey] of targets.entries()) {
      const current = existing.find((row) => row.categoryKey === categoryKey);
      if (current?.priority === index * 10) continue;
      await setAppCategory(canonical, categoryKey, index * 10);
    }
  } catch (cause) {
    /* 派生失败不阻断保存（理由见文件头）。留一条输出，便于排查「旧页改了不生效」。 */
    console.warn("[classification] syncing app category candidates failed", cause);
  }
}

/** 单个应用保存之后调用。 */
export async function syncCandidatesFromOverride(
  exeName: string,
  override: { category?: string | null; enabled?: boolean } | null,
): Promise<void> {
  await syncCandidates(exeName, candidateKeysForOverride(override));
}

/**
 * 批量保存（`commitDraftChangePlan`）之后调用。
 *
 * 只处理 `overrideUpserts`：其他字段（颜色、标签、分类定义）与新表无关。
 * 一个 exe 在一次提交里出现多次时以**最后一次**为准 —— 与 KV 的写入顺序语义相同
 * （同一个 key 后写的覆盖先写的）。
 */
export async function syncCandidatesFromOverrideUpserts(
  upserts: readonly { exeName: string; override: AppOverride | null }[],
): Promise<void> {
  const latest = new Map<string, AppOverride | null>();
  for (const update of upserts) {
    latest.set(resolveCanonicalExecutable(update.exeName), update.override);
  }
  for (const [exeName, override] of latest) {
    if (!exeName) continue;
    await syncCandidates(exeName, candidateKeysForOverride(override));
  }
}
