import { commitClassificationSettingMutations } from "../../../platform/persistence/classificationSettingsGateway.ts";
import { loadSettingRows } from "../../../platform/persistence/settingsPersistence.ts";
import { listTimingItems } from "../../../platform/persistence/timingReadRepository.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";

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
 * 写一条绑定；`itemId === null` 走删除分支（Rust 侧 `DELETE FROM settings`）。
 * `itemId` 非法时 `serializeAppItemBindingValue` 抛错 —— 请求不发出去，绝不变成删除。
 */
export async function saveAppItemBinding(exeName: string, itemId: number | null): Promise<void> {
  const key = buildAppItemBindingKey(exeName);
  if (!key) return;
  await commitClassificationSettingMutations([
    { key, value: serializeAppItemBindingValue(itemId) },
  ]);
}

/**
 * 候选事项清单。**不是** `useTodayItems`：那只有「今天有记录」的事项，
 * 而用户要绑的往往正是今天还没用过的那件事。
 */
export async function listAppItemBindingOptions(): Promise<AppItemBindingOption[]> {
  const items = await listTimingItems();
  return items.map((item) => ({ id: item.id, name: item.name, color: item.color }));
}
