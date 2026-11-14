/**
 * 「应用 ↔ 事项」绑定的**写计划**与**第二真源读取**（[R1]，从 `appItemBinding.ts` 拆出）。
 *
 * ## 为什么单独一层
 *
 * 绑定的两份真源在不同文件里：本目录的 `__app_item_binding::<exe>`（1:1，排行卡 / 事项编辑）
 * 与分类服务的 `__app_override::<exe>.itemBindings[]`（多事项，应用设置弹窗）。写 1:1 时
 * 必须同时看另一份 —— 否则"解绑"只删一处，另一处会在下次开机被启动补镜像读出来补回去。
 *
 * 判断全部收在这个纯函数里（`planAppItemBindingWrite`）：落库与发镜像都只照着返回值做，
 * 于是"载荷到底是 `[]` 还是 `[7]`"这种事有唯一一处可测的答案。
 */
import { loadSettingRows } from "../../../platform/persistence/settingsPersistence.ts";
import {
  parseAppOverride,
  type AppItemCategoryBinding,
} from "../../../shared/classification/appOverrideCodec.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";

/** 与 `classificationStore.ts` 的同名常量逐字一致（那边是模块私有，这里只读它） */
const APP_OVERRIDE_KEY_PREFIX = "__app_override::";

/**
 * 写一次绑定的完整计划（**纯函数**，判断全在这里，落库与发镜像都只照着做）。
 *
 * 三个字段各管一件事：
 *   · `rewriteOverride` / `nextItemBindings`：只在「这次是解绑、且 override 里确实有那一条」
 *     时为真 —— 这时才需要把 override 的 `itemBindings` 重写一遍（不重写就重启复活）；
 *   · `mirroredItemIds`：发镜像用的**真全集** = override ∪ 1:1（解绑时先摘掉那一条）。
 *     它永远不是"只有 1:1 的那一个"，否则同应用别的事项会被误删（R1）；
 *   · `removedItemId`：这次摘掉的是谁（`null` = 绑定/改绑，不是解绑）。
 *
 * 变异靶点：把 `mirroredItemIds` 写成 `nextItemId === null ? [] : [nextItemId]`（旧口径）
 * → `ad22` 红（载荷从 `[7]` 变 `[]`）。
 */
export interface AppItemBindingWritePlan {
  rewriteOverride: boolean;
  nextItemBindings: AppItemCategoryBinding[];
  mirroredItemIds: number[];
  removedItemId: number | null;
}

export function planAppItemBindingWrite(args: {
  /** 用户这次要写的 1:1 值（`null` = 解绑） */
  nextItemId: number | null;
  /** 原来的 1:1 值（解绑时"被解绑的那一个"就是它 —— 调用方手里没有 id） */
  previousItemId: number | null;
  /** override 里的多事项 id（已去重） */
  overrideItemIds: readonly number[];
}): AppItemBindingWritePlan {
  const base = [...new Set(args.overrideItemIds)];
  const removedItemId = args.nextItemId === null ? args.previousItemId : null;
  const remaining = removedItemId === null
    ? base
    : base.filter((itemId) => itemId !== removedItemId);
  const rewritten = remaining.length !== base.length;
  const mirrored = args.nextItemId === null
    ? remaining
    : remaining.includes(args.nextItemId) ? remaining : [...remaining, args.nextItemId];
  return {
    rewriteOverride: rewritten,
    nextItemBindings: remaining.map((itemId) => ({ itemId })),
    mirroredItemIds: mirrored,
    removedItemId,
  };
}

/**
 * 读某个应用的 override（`__app_override::<canonicalExe>` → `AppOverride | null`）。
 *
 * 键用 `resolveCanonicalExecutable` 归一 —— 与 `classificationStore.saveAppOverride` 同一个
 * 函数，否则读回来的和写进去的不是同一行。读失败**抛**（调用方显示"保存失败"），
 * 绝不降级成"没有 override"：那会让下一次写发出一份冒充全集的载荷。
 */
export async function loadAppOverrideFor(exeName: string): Promise<AppOverride | null> {
  const canonical = resolveCanonicalExecutable(exeName);
  if (!canonical) return null;
  const key = `${APP_OVERRIDE_KEY_PREFIX}${canonical}`;
  const rows = await loadSettingRows({ keyPrefix: key });
  const row = rows.find((entry) => entry.key === key);
  return row ? parseAppOverride(row.value) : null;
}
