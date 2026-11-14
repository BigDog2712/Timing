/**
 * 「应用 ↔ 事项」绑定的**真全集**与**一次性补镜像**（[第 6 条]，从 `appItemBinding.ts` 拆出）。
 *
 * ## 为什么单独一层
 *
 * 绑定有两份真源：1:1 的 `__app_item_binding::<exe>`（排行卡 / 事项编辑那一栏）与分类服务的
 * `__app_override::<exe>.itemBindings[]`（应用设置弹窗）。**任何只读一份的界面或镜像都会出错**，
 * 而且是两个方向相反的错：
 *   · 读侧只读 1:1 → 用户明明在应用设置里给「燕云」绑了事项，打开「编辑事项 → 绑定应用」
 *     却显示"还没有绑定应用"（用户报的第 6 条）；
 *   · 镜像侧按 1:1 视角逐应用发 `[itemId]` → 执行端（`hostIntentItemAppWrite`）把载荷当
 *     该应用的全集做三向 diff，于是"不在载荷里"的其它事项被 `unbindItemApp` **删掉**
 *     （P0：打开一次事项面板，就可能把同一个应用在别的事项上的绑定抹了）。
 *
 * 所以全集只在**这一个文件**里产出（`loadAppItemBindingUnions`），补镜像也只吃它的输出：
 * 调用方**没有**传一个"自己以为的全集"进来的口子 —— 上面那个 P0 的成因正是那个口子。
 *
 * ## 键空间
 *
 * 输出以「统计应用」为键（`resolveAppItemBindingExe` = `resolveStatisticalApp`：trim + 小写 +
 * 应用关联），与 `appItemBinding.ts` 的 1:1 键空间一致；override 的键是 canonical 口径，
 * 在这里归一到统计应用上（同一个统计应用的两条 override 会并进同一条）。发镜像时
 * `syncHostItemAppBindings` 内部再走 `normalizeAppKey`（`sessions.app_key` 口径）——两层归一
 * 各有各的对端，不能互相替代。
 */
import { syncHostItemAppBindings } from "../../../platform/runtime/itemAppBindingSync.ts";
import { loadAppItemBindings, resolveAppItemBindingExe } from "./appItemBinding.ts";
import { loadAppOverrideBindingSources } from "./appItemBindingPlan.ts";

/**
 * 一个应用的绑定全集。
 *
 * `oneToOne` 单独留着，是因为"解绑"要知道**被解掉的是哪一个**：调用方在本地更新状态时
 * 手里只有并集，没有它就不知道该从并集里摘谁（再读一次库又会带来新的闪烁）。
 */
export interface AppItemBindingUnion {
  /** 1:1 那一份（`__app_item_binding::`），`null` = 没有 */
  oneToOne: number | null;
  /** 真正生效的事项 id 全集 = 1:1 ∪ override.itemBindings，去重升序 */
  itemIds: number[];
  /**
   * override 明确标了「不计入」（`track === false`）：补镜像时要传 `track: 0`。
   *
   * ⚠️ **多行之间用 OR 合并是刻意的，别改成 last-wins**：这里的键是**统计应用**
   * （`resolveAppItemBindingExe` 走完 `__app_link__`），成员 exe 与父应用已经是同一个
   * 应用了 —— 没法"只对成员 exe 生效"。所以只要有任何一行说了"不计入"，整个统计应用就是
   * 不计入；反过来取 last-wins 会变成"谁的键恰好排在后面谁说了算"，
   * 每次开机 / 每次保存互相翻（用户视角是"我明明标了仅观察，它又自己接管了"）。
   * Rust 侧 `services/item_app_mirror.rs` 的 `track_off` 集合是同一条口径（口径 3 只让位
   * "哪些事项"，不让位"计不计入"）。判据 `ai12`（前端 OR）/ `single_item_key_keeps_the_track_off_flag`（Rust）。
   */
  trackOff: boolean;
}

/**
 * 两份真源 → `统计应用 → 全集`（**只含真的至少有一条绑定的应用**）。
 *
 * 两次读**并行**且**任一失败就整体抛**：补镜像拿到半份数据，就等于发一份冒充全集的载荷，
 * 会把另一份真源里的事项从 `item_app` 删掉 —— 这正是本文件要根治的错，不能在这里重犯。
 * 读失败的降级由调用方决定（界面降级为空，补镜像只 `console.warn` 且不缓存）。
 */
export async function loadAppItemBindingUnions(): Promise<Record<string, AppItemBindingUnion>> {
  const [oneToOneRows, overrideSources] = await Promise.all([
    loadAppItemBindings(),
    loadAppOverrideBindingSources(),
  ]);
  const unions: Record<string, AppItemBindingUnion> = {};
  const take = (exeName: string): AppItemBindingUnion => {
    const existing = unions[exeName];
    if (existing) return existing;
    const created: AppItemBindingUnion = { oneToOne: null, itemIds: [], trackOff: false };
    unions[exeName] = created;
    return created;
  };
  const addItemIds = (target: AppItemBindingUnion, itemIds: readonly number[]): void => {
    target.itemIds = [...new Set([...target.itemIds, ...itemIds])].sort((left, right) => left - right);
  };
  for (const [exeName, itemId] of Object.entries(oneToOneRows)) {
    const target = take(exeName);
    target.oneToOne = itemId;
    addItemIds(target, [itemId]);
  }
  for (const [exeName, source] of Object.entries(overrideSources)) {
    /* override 存的是 canonical 键，并进「统计应用」那条 —— 与 1:1 同一个键空间 */
    const key = resolveAppItemBindingExe(exeName);
    if (!key) continue;
    const target = take(key);
    if (source.trackOff) target.trackOff = true;
    addItemIds(target, source.itemIds);
  }
  return unions;
}

/**
 * 存量绑定的**一次**补镜像（[0.13 fix]，进程内只跑一次）。
 *
 * ## 为什么需要它（不做的话，修完之后老用户还是"绑了不计时"）
 *
 * 在 0.13 那次修复之前，这个仓库里**没有任何代码**往宿主 `item_app` 写行：
 * `legacy_bindings::backfill` 有实现、有命令、有前端封装，但那个封装零调用方。修完之后
 * 新保存的绑定会被镜像（`saveAppItemBinding`），但**已经存下的那些**没人补 ——
 * 界面显示「已绑定」、切过去仍然不计时，比不显示更糟。
 *
 * ## 载荷必须是**并集**（[第 6 条] 的 P0）
 *
 * 本函数原来收一个 `Record<exe, itemId>`（1:1 视角），于是每个应用只发 `[itemId]` 一条。
 * 执行端按"该应用全集"做三向 diff，**不在载荷里的其它事项会被解绑** —— 用户视角就是
 * "我打开了一次事项面板，它在另一个事项上的绑定没了"。现在它**自己**读两份真源
 * （`loadAppItemBindingUnions`），调用方无法再传一个单事项视图进来。
 *
 * 幂等（执行端做三向 diff，已经在位的不会重复写）、一次性（模块级 promise）、
 * 失败**不缓存**（置回 null，下次进界面再试）—— 这个通道没有回执，唯一的重试点就是
 * "用户下一次打开"。
 *
 * ## 边界
 *
 * Rust 侧那条 `backfill_legacy_bindings` **不在这里调**：它会顺带把 KV 里的分类数组重新灌进
 * `app_category`，而映射视图改的正是那张表 —— 在一次普通界面加载里做这件事，会把用户刚在
 * 映射视图里调过的分类顺序覆盖回去。
 */
let legacyMirrorPromise: Promise<void> | null = null;

export function mirrorItemBindingsOnce(): Promise<void> {
  if (legacyMirrorPromise) return legacyMirrorPromise;
  legacyMirrorPromise = loadAppItemBindingUnions()
    .then((unions) => Promise.all(
      Object.entries(unions).map(([exeName, union]) =>
        syncHostItemAppBindings(exeName, union.itemIds, union.trackOff ? 0 : undefined)),
    ))
    .then(() => undefined)
    .catch((error: unknown) => {
      legacyMirrorPromise = null;
      console.warn("[binding] 存量绑定补镜像失败", error);
    });
  return legacyMirrorPromise;
}
