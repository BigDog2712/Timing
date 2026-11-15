/**
 * 分析窗 → 药丸：把「应用 ↔ 事项」绑定镜像进宿主业务库的 `item_app` 表。
 *
 * ## 为什么需要一层专门的网关
 *
 * 分析窗的两个绑定界面（应用排行卡双击 → 「绑定事项」、数据页应用设置里的
 * 「事项 ↔ 分类」清单）写的是**分析窗自己的配置表**（`__app_item_binding::<exe>` /
 * `__app_override::<exe>`），而药丸的「切到绑定的应用就自动接管计时」读的是
 * **宿主业务库的 `item_app`**。两张表之间原本只有一次性回填
 * （`services/insight/data/legacy_bindings.rs`，守卫键 `__migration_item_centric::v1`）
 * —— 回填跑完之后，用户在界面上新绑的东西永远进不了 `item_app`，
 * 于是「绑了却不计时」且**两端零日志**。这里补的就是那一段漏掉的镜像写。
 *
 * ## 口径（三条，改之前先读）
 *
 *   1. **键走 `normalizeAppKey`**，不是 `resolveAppItemBindingExe`。配置表用「统计应用」
 *      口径（会走应用关联 `__app_link::`），`item_app` 这一侧必须与 `sessions.app_key`
 *      同一个产出函数 —— 那是 Rust `normalize_app_key` 的逐字复刻，也是药丸查询时用的
 *      那个键。两边用错一个，绑了也查不到（这正是本 bug 的形态，别再引入第二份归一）。
 *   2. **载荷是该应用的事项全集**：执行端做三向 diff（多了解绑 / 少了绑定 / `track` 变了
 *      重绑），所以**只有一个事项视角的调用方不许调** —— 它会误删同一应用在别的事项上的
 *      绑定。全集只有一个产出点：`features/dashboard/services/appItemBindingMirror.ts` 的
 *      `loadAppItemBindingUnions()`（1:1 ∪ `__app_override::` 两份真源）。
 *      [第 6 条] 这条口径以前写在注释里、代码里没有：存量补镜像按 1:1 视角逐应用发
 *      `[itemId]`，于是**打开一次事项面板就可能把该应用在别的事项上的绑定解绑掉**（P0）。
 *      现在补镜像**自己读**两份真源，调用方**没有**传视图进来的口子。
 *   3. **没有回执**：`emitHostIntent` 只回答「有没有发出去」，成败由药丸侧的 `setNotice`
 *      呈现（§6.5「跨窗只传意图，不传错误」）。所以这里不抛错、不弹窗。
 */
import { normalizeAppKey } from "../../../shared/appKey.ts";
import { emitHostIntent } from "./hostIntentGateway.ts";

/**
 * 把某个应用在宿主 `item_app` 里的绑定拉成 `itemIds`（空数组 = 全解绑）。
 *
 * `track` 缺省 `1`（计入并接管计时）；应用被标成「不计入」（`AppOverride.track === false`）
 * 时传 `0`，免得「我故意不让它接管」被镜像覆盖掉。
 * 返回「意图有没有发出去」——**不是**「宿主写成了没有」。
 */
export function syncHostItemAppBindings(
  exeName: string,
  itemIds: readonly number[],
  track?: number,
): Promise<boolean> {
  const appKey = normalizeAppKey(exeName);
  if (!appKey) return Promise.resolve(false);
  const payload = track === 0
    ? { action: "sync_app_item_bindings" as const, appKey, itemIds, track: 0 }
    : { action: "sync_app_item_bindings" as const, appKey, itemIds };
  return emitHostIntent(payload);
}
