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
  normalizeItemBindings,
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
 * 每个字段各管一件事：
 *   · `rewriteOverride` / `nextItemBindings`：只在「这次是解绑、且 override 里确实有那一条」
 *     时为真 —— 这时才需要把 override 的 `itemBindings` 重写一遍（不重写就重启复活）；
 *   · `mirroredItemIds`：发镜像用的**真全集** = override ∪ 1:1（解绑时先摘掉那一条）。
 *     它永远不是"只有 1:1 的那一个"，否则同应用别的事项会被误删（R1）；
 *   · `removedItemId`：这次摘掉的是谁（`null` = 绑定/改绑，不是解绑）；
 *   · `clearOneToOne`：1:1 键要不要一起删（[第 6 条]：只有"摘的那一条 == 1:1 指的那一条"
 *     才删 —— 否则事项视角解绑事项 9 会顺手删掉 1:1 上的事项 3）。
 *
 * 变异靶点：把 `mirroredItemIds` 写成 `nextItemId === null ? [] : [nextItemId]`（旧口径）
 * → `ad22` 红（载荷从 `[7]` 变 `[]`）；把 `clearOneToOne` 恒 true → `ad27` 红；
 * 把 `removeItemId ??` 摘掉 → `ad27` 红（摘错成 1:1 那条）。
 */
export interface AppItemBindingWritePlan {
  rewriteOverride: boolean;
  nextItemBindings: AppItemCategoryBinding[];
  mirroredItemIds: number[];
  removedItemId: number | null;
  clearOneToOne: boolean;
}

export function planAppItemBindingWrite(args: {
  /** 用户这次要写的 1:1 值（`null` = 解绑） */
  nextItemId: number | null;
  /** 原来的 1:1 值（解绑时"被解绑的那一个"就是它 —— 调用方手里没有 id） */
  previousItemId: number | null;
  /** override 里的多事项 id（已去重） */
  overrideItemIds: readonly number[];
  /**
   * 调用方**明确知道**"要摘掉的是哪一个"时传它（事项视角：当前事项 id）。
   * 不传（应用视角：界面上只有一个主值）时才退回 `previousItemId ?? base[0]`。
   */
  removeItemId?: number | null;
}): AppItemBindingWritePlan {
  /* 升序：与 `loadAppItemBindingUnions` 的 `itemIds` 同一个顺序 —— 「并集里的第一个」
     在两处必须是同一个事项，否则界面显示 7、实际摘掉 9（[第 6 条] 见下方 fallback）。 */
  const base = [...new Set(args.overrideItemIds)].sort((left, right) => left - right);
  /* [第 6 条] 显式 `removeItemId` 优先；否则 1:1；1:1 也为空时取**并集里的第一个**。
     为什么需要最后的 fallback：应用视角的界面主值就是 `oneToOne ?? itemIds[0]`，只在应用设置
     弹窗里绑过（override 型、没有 1:1）的应用因此会"看得见、摘不掉"——`removedItemId` 为 null
     时 `remaining === base`，一个键都不重写，下次读库那条又回来。
     为什么 `removeItemId` 必须能盖过前两者：事项视角解绑的是**当前事项**，不一定是 1:1 指的那条，
     也不一定是并集第一个 —— 拿错会去解绑用户没碰的那一条（`ad27`）。 */
  const removedItemId = args.nextItemId === null
    ? args.removeItemId ?? args.previousItemId ?? base[0] ?? null
    : null;
  const remaining = removedItemId === null
    ? base
    : base.filter((itemId) => itemId !== removedItemId);
  const rewritten = remaining.length !== base.length;
  /* 1:1 键要不要一起删：只有"摘的那一条 == 1:1 指的那一条"才删（或本来就没有 1:1 / 纯清除） */
  const clearOneToOne = removedItemId === null
    || args.previousItemId === null
    || args.previousItemId === removedItemId;
  /* [QA 验收 · P0] 载荷 = 摘完之后**还活着**的全集 = override 剩下的 + 仍然存活的 1:1。
     `remaining` 只来自 override，1:1 那一条**不一定在 override 里**：应用设置弹窗先绑 9
     （override=[9]）→ 排行卡再绑 3（1:1=3，载荷 [3,9]）→ 事项面板在 9 上解绑。
     此时 `remaining=[]`，只发 `remaining` 就等于发"空全集"，执行端把事项 3 的 `item_app`
     行删掉，而 KV 里 1:1=3 一动没动、界面照旧显示"已绑定 3" —— 界面与宿主静默分叉，
     要等下次重启 Rust 补镜像才自愈（正是本次要修的那个症状的另一半）。判据 `ad28`。
     `clearOneToOne === false` 恒等价于"1:1 指向的那一条还在"，所以它必须并回载荷。 */
  const survivors = args.previousItemId !== null && !clearOneToOne ? [args.previousItemId] : [];
  /* 升序去重：与 `loadAppItemBindingUnions` 的 `itemIds` 同一个顺序（本文件头注的承诺） */
  const mergeAscending = (extra: readonly number[]): number[] =>
    [...new Set([...remaining, ...extra])].sort((left, right) => left - right);
  const mirrored = mergeAscending(args.nextItemId === null ? survivors : [args.nextItemId]);
  return {
    rewriteOverride: rewritten,
    nextItemBindings: remaining.map((itemId) => ({ itemId })),
    mirroredItemIds: mirrored,
    removedItemId,
    clearOneToOne,
  };
}

/**
 * 一个应用在 override 里声明的绑定（**第二真源的整表形态**，[第 6 条]）。
 *
 * `itemIds` 已过 `normalizeItemBindings`（丢非法 id / 去重），`trackOff` 是该应用有没有被
 * 明确标成「不计入」—— 镜像 `item_app` 时要传 `track: 0`，否则"我故意不让它接管"会被
 * 这条补镜像覆盖成接管（`hostIntentItemAppWrite` 的 `track` 语义）。
 */
export interface AppOverrideBindingSource {
  itemIds: number[];
  trackOff: boolean;
}

/** 与 `classificationStore.ts` 的 `__app_override::` 前缀同口径：整表读一次，不逐应用查 */
export async function loadAppOverrideBindingSources(): Promise<Record<string, AppOverrideBindingSource>> {
  const rows = await loadSettingRows({ keyPrefix: APP_OVERRIDE_KEY_PREFIX });
  const sources: Record<string, AppOverrideBindingSource> = {};
  for (const row of rows) {
    if (!row.key.startsWith(APP_OVERRIDE_KEY_PREFIX)) continue;
    /* 键**原样**（canonical）保留：调用方要按「统计应用」口径再归一时由它自己做，
       这里少做一次归一就少一处"两边不是同一个函数"的机会。 */
    const exeName = row.key.slice(APP_OVERRIDE_KEY_PREFIX.length).trim();
    if (!exeName) continue;
    const override = parseAppOverride(row.value);
    if (!override) continue;
    const itemIds = normalizeItemBindings(override.itemBindings).map((binding) => binding.itemId);
    if (itemIds.length === 0) continue;
    sources[exeName] = { itemIds, trackOff: override.track === false };
  }
  return sources;
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
