import { commitClassificationSettingMutations, type ClassificationSettingMutation } from "../../../platform/persistence/classificationSettingsGateway.ts";
import { syncHostItemAppBindings } from "../../../platform/runtime/itemAppBindingSync.ts";
import { loadSettingRows } from "../../../platform/persistence/settingsPersistence.ts";
import { listTimingItems } from "../../../platform/persistence/timingReadRepository.ts";
import { normalizeItemBindings } from "../../../shared/classification/appOverrideCodec.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { ClassificationService } from "../../classification/services/classificationService.ts";
import { buildSaveAppOverrideMutations } from "../../classification/services/classificationStore.ts";
import { buildQuickAppOverride } from "../../classification/services/quickClassification.ts";
import { loadAppOverrideFor, planAppItemBindingWrite } from "./appItemBindingPlan.ts";

/**
 * 应用 → 事项的**绑定配置**（0.12.1「双击应用行」那一轮补回的交互）。
 *
 * 口径（主理人已拍板，别扩）：
 *   · **只存配置**：设置表 KV，`__app_item_binding::<exeName>` → `{"itemId":123}`。
 *   · **键空间只有一种**：`exeName` 一律经 `resolveAppItemBindingExe()`
 *     （= `AppClassification.resolveStatisticalApp`：trim + 小写 + 应用关联）归一后
 *     再落表 / 查表。写侧（`createQuickAppClassificationTarget`）本来就这么归一，
 *     读侧与行标记必须用**同一个函数** —— 否则 `Code.exe` 这类保留原始大小写的统计行
 *     永远查不到 `code.exe` 那条键（0.12.1 S1：绑定确实进了 KV，行上却没有标记）。
 *   · **不做自动归因**：本轮不把「用该事项计时」接进追踪/记录写入，只是让用户把
 *     「这个应用平时做哪件事」记下来，行上给一个标记。
 *   · **清除 = 删行**（value 传 `null`）：留下的 `{"itemId":null}` 会让「未绑定」有两种
 *     表示法，读侧就得同时认两种，没必要。
 *   · **全局的**（exe → item），与卡片实例无关：板上放两张应用卡，两边必须一致。
 *
 * 为什么走 `commitClassificationSettingMutations`：它是既有的「写设置表」唯一通道
 * （Rust 侧 `is_allowed_classification_setting_key` 是**前缀白名单**，新前缀已在那张表里
 * 登记）。不新增 IPC 命令 —— insight 命令数被 contract 门禁钉着。
 */

/** 与 Rust `models/insight/classification.rs` 的同名常量逐字一致 */
export const APP_ITEM_BINDING_KEY_PREFIX = "__app_item_binding::";

/** 弹层里那一栏的候选项（`listTimingItems()` 的全量未归档事项） */
export interface AppItemBindingOption {
  id: number;
  name: string;
  /** 事项自带颜色（空串 = 没设），行标记的小色点用它 */
  color: string;
}

/**
 * 键空间归一：读、写、行标记**必须**共用这一个函数（0.12.1 S1）。
 *
 * 用 `resolveStatisticalApp` 而不是 `resolveCanonicalExecutable`：除了 trim + 小写，
 * 它还要把「应用关联」（`__app_link::`）走完 —— 否则同一个统计应用的两个 exe
 * 会各存一条绑定，与分类 / 改名用的键也不是同一个。
 */
export function resolveAppItemBindingExe(exeName: string): string {
  return AppClassification.resolveStatisticalApp(exeName);
}

/**
 * 键构造。空 exe 名返回 `null` 而不是抛 —— 调用点在渲染/事件回调里，
 * 一个脏数据不该把整张卡炸掉（`createQuickAppClassificationTarget` 那边是抛的，
 * 因为它有 IPC 前置校验；这里没有）。
 *
 * exe 名在这里**归一**（不是只 trim）：写侧归一一遍、读侧再归一一遍，键空间才只有一种。
 */
export function buildAppItemBindingKey(exeName: string): string | null {
  const normalized = resolveAppItemBindingExe(exeName);
  if (!normalized) return null;
  return `${APP_ITEM_BINDING_KEY_PREFIX}${normalized}`;
}

/**
 * 值序列化。`null` **只**表示「清除」（写的时候传 `value: null` → Rust 侧删行）；
 * 非 null 但不合法（非安全整数 / ≤ 0）**抛错**，不再与「清除」共用 `null` ——
 * 否则任何一处把 `0` 当成「未选择」传进来，就会静默删掉用户已有绑定（0.12.1 G3）。
 * 抛错经 `saveAppItemBinding` 冒到弹层的 `onError`（那里 catch 后显示「保存失败」），
 * 用户看得见，比静默清库好。
 */
export function serializeAppItemBindingValue(itemId: number | null): string | null {
  if (itemId === null) return null;
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new RangeError(`App item binding requires a positive safe integer, got ${String(itemId)}`);
  }
  return JSON.stringify({ itemId });
}

/**
 * 值解析。三个失败条件都返回 `null`（= 当作未绑定）：
 * JSON 坏、`itemId` 不是正整数、`itemId` 不是安全整数 —— 脏数据静默降级，
 * **不主动清库**（绑定的事项被删掉时同口径：UI 不显示标记，行留在表里）。
 */
export function parseAppItemBindingValue(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const itemId = (parsed as { itemId?: unknown }).itemId;
  if (typeof itemId !== "number" || !Number.isSafeInteger(itemId) || itemId <= 0) return null;
  return itemId;
}

/**
 * `settings` 行 → `exeName → itemId`（一次性读全表前缀，不按行逐个查）。
 *
 * 键在**这里**归一（`resolveAppItemBindingExe`，与写侧同一个函数）：历史行里若留着
 * 原始大小写，也照样查得到。归一后撞成一条时**后出现的覆盖先出现的** ——
 * map 里不留大小写两份（先到那条不删库，只是不再生效）。
 */
export function parseAppItemBindingRows(
  rows: readonly { key: string; value: string }[],
): Record<string, number> {
  const bindings: Record<string, number> = {};
  for (const row of rows) {
    if (!row.key.startsWith(APP_ITEM_BINDING_KEY_PREFIX)) continue;
    const exeName = resolveAppItemBindingExe(row.key.slice(APP_ITEM_BINDING_KEY_PREFIX.length));
    if (!exeName) continue;
    const itemId = parseAppItemBindingValue(row.value);
    if (itemId === null) continue;
    bindings[exeName] = itemId;
  }
  return bindings;
}

/** 一次前缀读全表。抛错交给调用方降级（`useAppItemBindings` 里变空对象）。 */
export async function loadAppItemBindings(): Promise<Record<string, number>> {
  const rows = await loadSettingRows({ keyPrefix: APP_ITEM_BINDING_KEY_PREFIX });
  return parseAppItemBindingRows(rows);
}

/**
 * 读**单个应用**的 1:1 绑定（`__app_item_binding::<exe>`）。
 *
 * `null` = 这个应用没有 1:1 绑定；**抛错 = 读不到**（调用方自己降级，见
 * `useAppEditDialog` 的保存分支）。两者不能混：把"读不到"当成"没有"，下一次保存就会
 * 把用户那条绑定当成"用户取消了"删掉。
 *
 * 为什么按**完整键**做前缀而不是整表：应用设置弹窗一次只看一个应用，
 * 顺手把全表拉回来没有意义（那张表还有 `parseAppItemBindingRows` 那条全表口径给别处用）。
 */
export async function loadAppItemBindingFor(exeName: string): Promise<number | null> {
  const key = buildAppItemBindingKey(exeName);
  if (!key) return null;
  const rows = await loadSettingRows({ keyPrefix: key });
  const row = rows.find((entry) => entry.key === key);
  return parseAppItemBindingValue(row?.value ?? null);
}

/**
 * **只**清 1:1 键，**不发镜像**（[0.13 fix · P0-3]）。
 *
 * 为什么不能直接 `saveAppItemBinding(exe, null)`：那个函数清完 KV 还会发一条
 * `itemIds: []` —— 1:1 视角下"空"确实等于全集，但本函数的使用场景恰恰是
 * **全集里还留着别的事项**（用户只取消了 1:1 指的那一个）。发 `[]` 会把那些行一起删掉，
 * 界面上却看不出来。所以：清 KV 与"发全集"这两件事必须分开，且**先清 KV 再发全集**
 * （顺序反了的话，中途失败会让启动补镜像把刚删的行补回来）。
 */
export async function clearAppItemBinding(exeName: string): Promise<void> {
  const key = buildAppItemBindingKey(exeName);
  if (!key) return;
  await commitClassificationSettingMutations([{ key, value: null }]);
}

/**
 * 写一条绑定；`itemId === null` 走删除分支（Rust 侧 `DELETE FROM settings`）。
 * `itemId` 非法时 `serializeAppItemBindingValue` 抛错 —— 请求不发出去，绝不变成删除。
 *
 * [0.13 fix] 配置落盘之后**再镜像到宿主 `item_app`**：自动接管读的是那张表，
 * 只写这张 KV 就等于「界面上绑好了、切过去不计时」（用户报的那个 bug）。
 *
 * ## [R1] 镜像发的是**真全集**，不是 1:1 视角的 `[itemId]` / `[]`
 *
 * 同一个应用的两份真源：本文件的 1:1 键，与应用设置弹窗的
 * `__app_override::<exe>.itemBindings[]`。执行端（`hostIntentItemAppWrite`）把载荷当
 * **该应用的全集**做三向 diff，所以这里发 `[]` 就会把同应用另一个事项的行一起解绑 ——
 * 用户的观感是「我在事项里解绑了燕云，结果写代码这件也不计时了」。
 *
 * 所以解绑时做两件事（一次 commit，两个键一起写）：
 *   1. 删 1:1 键（**仅当**要摘的那一条就是 1:1 指的那一条，见下）；
 *   2. 若 override 里也有这个 itemId，把它从 `itemBindings` 里摘掉
 *      （不摘的话启动补镜像读 override 会把它**补回来** —— 重启又自动计时）。
 * 然后按摘完之后的并集发镜像。
 *
 * ## [第 6 条] 第三个参数 `removeItemId`：解绑的是**哪一个**事项
 *
 * 两个调用方的语义不同，不能共用"1:1 那一条"来猜：
 *   · **应用视角**（排行卡的行内编辑 `useAppItemBindings`）：界面上只有一个主值
 *     `oneToOne ?? itemIds[0]`，不传第三个参数 → 计划自己按同一条规则推；
 *   · **事项视角**（「编辑事项 → 绑定应用」`useItemAppBindings`）：解绑的是**当前事项**，
 *     它可能既不是 1:1 指的那条、也不是并集第一个（应用同时绑了事项 3 与 9，用户在 9 上解绑）。
 *     这时必须传 `removeItemId = 9`，否则会去摘 3 —— 用户没碰的那一条被删掉（`ad27` 钉住）。
 *     同一条规则也决定 **1:1 键删不删**：只有 `previousItemId === removedItemId` 时才删。
 */
export async function saveAppItemBinding(
  exeName: string,
  itemId: number | null,
  removeItemId: number | null = null,
): Promise<void> {
  const key = buildAppItemBindingKey(exeName);
  if (!key) return;
  /* 先把值算出来：非法 id 在这里抛，写命令一条都不会发出去 */
  const value = serializeAppItemBindingValue(itemId);
  /* 两份真源都要读，且**读失败就抛**（调用方显示"保存失败"）：把"读不到"当成"没有"
     会发出一条冒充全集的载荷，把同应用别的事项一起解绑。 */
  const [previousItemId, override] = await Promise.all([
    loadAppItemBindingFor(exeName),
    loadAppOverrideFor(exeName),
  ]);
  const plan = planAppItemBindingWrite({
    nextItemId: itemId,
    previousItemId,
    overrideItemIds: normalizeItemBindings(override?.itemBindings).map((binding) => binding.itemId),
    removeItemId,
  });

  const mutations: ClassificationSettingMutation[] = [];
  if (itemId !== null || plan.clearOneToOne) mutations.push({ key, value });
  if (plan.rewriteOverride) {
    /* 走唯一重建入口：它负责"其余维度原样保留"，以及"没有任何字段了就整条置 null" */
    const next = buildQuickAppOverride(override, { itemBindings: plan.nextItemBindings });
    mutations.push(...buildSaveAppOverrideMutations(exeName, next));
  }
  if (mutations.length > 0) await commitClassificationSettingMutations(mutations);
  if (plan.rewriteOverride) {
    /* bootstrap 缓存里那份 override 还是带旧 itemBindings 的：不清掉，下一次打开
       应用设置弹窗会把它写回去（同一个"重启复活"的另一种走法）。 */
    ClassificationService.invalidateBootstrapCache();
  }
  await syncHostItemAppBindings(exeName, plan.mirroredItemIds);
}

/**
 * 候选事项清单。**不是** `useTodayItems`：那只有「今天有记录」的事项，
 * 而用户要绑的往往正是今天还没用过的那件事。
 */
export async function listAppItemBindingOptions(): Promise<AppItemBindingOption[]> {
  const items = await listTimingItems();
  return items.map((item) => ({ id: item.id, name: item.name, color: item.color }));
}

/**
 * 存量绑定的补镜像（`mirrorItemBindingsOnce`）与**真全集**（`loadAppItemBindingUnions`）
 * 都在 `appItemBindingMirror.ts`：前者要同时读本文件的 1:1 与 override 两份真源，
 * 而本文件卡在 300 行硬限上（同 R1 把写计划摊到 `appItemBindingPlan.ts` 的理由）。
 * 补镜像的载荷必须是**并集** —— 只发 1:1 视角的 `[itemId]` 会误删同应用其它事项的绑定。
 */
