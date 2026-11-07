/**
 * Timing — 设置 · 数据管理 · 单框 ↔ 三档的纯函数（V0.11.16，设计 §3.2）
 * -----------------------------------------------------------------------------
 * 本轮的**核心口径**（坑 1 的答案）：块①那个「日记文件名」框与块③那个「日记落点」框
 * **不是**三档的镜像，而是「一条待执行的统一意图」。
 *
 * ```
 * shared.file === null     用户没动过这个框 → 保存时三档**原值原样**落库
 * shared.file === 'x.md'   用户亲手改过     → 保存时三档统一写成 'x.md'
 * ```
 *
 * 为什么必须是三态而不是「单框一律写三档」：老用户从 v0.10 升级上来时三档 `root`
 * 往往不同（merge 补进来的 `todos` 用 `%APP_DIR%\md`，前两档是 Obsidian 目录）。只要
 * 一次的「什么都没改的保存」就把三档统一掉，等于悄悄搬了用户的文件——PRD N2 明令禁止，
 * 且不可逆（`settings` 表里那份 JSON 被覆盖）。
 *
 * 本文件只做「把一份输入变成另一份」，不读 state、不碰网络、不发请求：否则这条 bug
 * 只能靠手点验证，而它恰好是最难手点出来的那种。
 */
import type { MdSyncBinding } from '../../types/domain';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';

/** 参与「一个框写三档」的两个字段。`heading` 不在此列：三个标题本来就是三种东西。 */
export type MdSyncSharedField = 'file' | 'root';

/** `null` = 用户没动过；字符串 = 亲手改过（改回原值也会变回 `null`）。 */
export interface MdSyncShared {
  file: string | null;
  root: string | null;
}

/** 干净态：单例避免每次渲染新建对象（`useMemo` 的依赖里会出现它） */
export const NO_SHARED: MdSyncShared = { file: null, root: null };

/**
 * 单框的**基准档**：计时那一档（`timers`）。
 *
 * 三档一致时它就是三者的共同值；不一致时也只显示它，另外两档靠灰字提示 +
 * 「逐个设置」暴露——这是 PRD 4.1 明确的口径（「文件名框显示计时那一档的值」）。
 *
 * **全应用只有这一处**「哪一档是基准」的答案：块③的「今天：…」那行与「打开今日文件」
 * 按钮都调它，不再各写一个 `bindings[0]`。后端出厂顺序确实是 `timers → notes → todos`
 * （`models/md_sync_config.rs` 有断言），但那是**后端**的保证；前端若靠下标就等于把
 * 一条口头约定当成类型，换个排序理由（比如按 `enabled` 排）就整块错位。
 */
export function baseOf(bindings: MdSyncBinding[]): MdSyncBinding | undefined {
  return bindings.find((binding) => binding.kind === 'timers') ?? bindings[0];
}

/** 单框显示的基准值（三档一致时 = 共同值；不一致时 = 计时档的值） */
export function mirrorOf(bindings: MdSyncBinding[], field: MdSyncSharedField): string {
  return baseOf(bindings)?.[field] ?? '';
}

/** 三档这一字段是否不全相同 → 决定出不出灰字提示 + 「逐个设置」入口 */
export function isMixed(bindings: MdSyncBinding[], field: MdSyncSharedField): boolean {
  if (bindings.length < 2) return false;
  const first = bindings[0][field];
  return bindings.some((binding) => binding[field] !== first);
}

/** 单框当前显示值：用户改过就看意图，没改过就看计时档 */
export function sharedValue(
  bindings: MdSyncBinding[],
  shared: MdSyncShared,
  field: MdSyncSharedField,
): string {
  return shared[field] ?? mirrorOf(bindings, field);
}

/**
 * 扇出：`null` 的字段保留各档原值，字符串的字段覆盖三档。
 *
 * 这是**保存与「测试连接」共用的唯一出口**（`draft.resolvedBindings`）。两处各算一份
 * 就会出现「测试按草稿的旧三档跑、保存按新的写」这类没人能复现的错。
 */
export function applyShared(bindings: MdSyncBinding[], shared: MdSyncShared): MdSyncBinding[] {
  return bindings.map((binding) => ({
    ...binding,
    file: shared.file ?? binding.file,
    root: shared.root ?? binding.root,
  }));
}

/**
 * 一次编辑 → 新的共享值。**改回原值即视为没改**。
 *
 * 少了这一条，用户「点进去、打一个字、删掉、离开」就会被当成显式意图，保存时把
 * 另外两档一起改掉——这正是 PRD R-3 里那个不可逆的误伤。
 */
export function sharedAfterEdit(base: string, next: string): string | null {
  return next === base ? null : next;
}

/** 被关掉同步的档（提示行用）：`['notes']` → 「便利贴这一档已关闭同步。」 */
export function disabledKinds(bindings: MdSyncBinding[]): MdSyncBinding['kind'][] {
  return bindings.filter((binding) => !binding.enabled).map((binding) => binding.kind);
}

/**
 * 与基准档**不同**的那些档（提示行只列不同项，PRD 4.4）。
 *
 * 基准档自己不列：它在单框里已经显示着，再列一次只是重复。`label` 用
 * `MD_SYNC_KIND_LABELS`（种类名只有一份），调用方直接交给 `mixedRootNote`。
 */
export function differingBindings(
  bindings: MdSyncBinding[],
  field: MdSyncSharedField,
): { kind: MdSyncBinding['kind']; label: string; value: string }[] {
  const base = baseOf(bindings);
  if (!base) return [];
  return bindings
    .filter((binding) => binding.kind !== base.kind && binding[field] !== base[field])
    .map((binding) => ({
      kind: binding.kind,
      label: MD_SYNC_KIND_LABELS[binding.kind],
      value: binding[field],
    }));
}
