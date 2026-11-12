/**
 * Timing — 手柄绑定的读写（纯 IO，只 import `./handleCatalog`）
 * -----------------------------------------------------------------------------
 * 为什么手柄绑定单独占一个 localStorage 键，而不是塞进 `timing.appearance.v1`：
 * `appearanceStore.commit()` 是**逐字段重建对象再整串写回**，只要用户拖一次不透明度滑杆，
 * 嵌在里面的 `handles` 就会被抹回默认。分开之后两个写入方物理上不可能互相覆盖，
 * `appearanceStore` 与其测试**零改动**。
 *
 * 为什么键名不写进 `src/lib/storageKeys.ts`：那张表的语义是「v0.5.0 改名双读（新键 / 老键 / 回写）」，
 * 而本键是全新键、没有老键；塞进去就必须为 `LEGACY_STORAGE_KEYS` 编一个假老键
 * （类型是 `Record<StorageKeyName, string>`，不可省），反而制造「两个键名都合法」的错觉。
 * 所以键字面量**全仓只出现一次**，就是下面这一行。
 *
 * 读坏不写盘：`load` 路径里**没有**任何 `setItem`。用户手工改坏的配置只会被「当成默认读」，
 * 原值留在磁盘上，下次修好还能救回来；覆盖写只在用户真的动了控件（`save`）时发生。
 */
import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_ACTIONS,
  HANDLE_FORMS,
  HANDLE_SLOTS,
} from './handleCatalog';
import type {
  HandleBindings,
  HandleForm,
  HandleFormBinding,
  HandleSlot,
  StoredHandleBindings,
} from './handleCatalog';

const HANDLE_BINDINGS_KEY = 'timing.handles.v1';

/** 单槽归一：非字符串、或字符串但不在目录里 → `null`（渲染成「无」）。 */
type SlotValues = Record<HandleSlot, string | null>;

/** 目录是活的（单测会往里 push 假动作），所以每次现查，不建模块级 Set 缓存。 */
export function isKnownActionId(id: string): boolean {
  for (const action of HANDLE_ACTIONS) if (action.id === id) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 取某形态的**出厂副本**（深一层）。永远拷贝，调用方改返回值不会污染默认表。 */
function cloneDefaultForm(form: HandleForm): HandleFormBinding {
  const preset = DEFAULT_HANDLE_BINDINGS[form];
  return { enabled: preset.enabled, slots: { ...preset.slots } };
}

function defaultBindings(): HandleBindings {
  const out = {} as HandleBindings;
  for (const form of HANDLE_FORMS) out[form] = cloneDefaultForm(form);
  return out;
}

function parseSlots(raw: unknown): SlotValues {
  const source = isPlainObject(raw) ? raw : {};
  const out = {} as SlotValues;
  for (const slot of HANDLE_SLOTS) {
    const value = source[slot];
    /* 规则 5 / 6：缺 key、非字符串、字符串但不在目录里 —— 一律 `null`。
       未知 id 不抛也不 console.error：那是用户手改配置的正常后果，不是程序缺陷。 */
    out[slot] = typeof value === 'string' && isKnownActionId(value) ? value : null;
  }
  return out;
}

/**
 * 把任意输入归一成合法的 `HandleBindings`（纯函数、永不 throw）。
 *
 * 规则按序（任一条命中即停在该形态上继续处理下一个形态）：
 *  1. 非对象 / `null` / 数组 → 全默认
 *  2. `version !== 1` → 全默认 + `console.warn` 一次（未来版本降级要有痕迹）
 *  3. `forms` 缺某形态（或该形态不是对象）→ 该形态取默认，其余保留
 *  4. `enabled` 非布尔 → 取该形态默认值
 *  5. `slots` 缺 key / 值非字符串 → 该槽 `null`
 *  6. 值在目录里查不到 → 该槽 `null`
 *  7. 多出来的形态名（如 `bubble`）→ 直接忽略（前向兼容）
 */
export function parseHandleBindings(raw: unknown): HandleBindings {
  if (!isPlainObject(raw)) return defaultBindings();
  if (raw.version !== 1) {
    console.warn('[handles] 手柄绑定的 version 不是 1，整份回落默认（不写盘）');
    return defaultBindings();
  }
  const forms = isPlainObject(raw.forms) ? raw.forms : {};
  const out = {} as HandleBindings;
  for (const form of HANDLE_FORMS) {
    const formRaw = forms[form];
    if (!isPlainObject(formRaw)) {
      out[form] = cloneDefaultForm(form);
      continue;
    }
    out[form] = {
      enabled: typeof formRaw.enabled === 'boolean' ? formRaw.enabled : DEFAULT_HANDLE_BINDINGS[form].enabled,
      slots: parseSlots(formRaw.slots),
    };
  }
  return out;
}

/**
 * 读出生效的手柄绑定。**永不 throw**（药丸每次 `pointerenter` 都会调它，
 * 抛一次就等于整个手柄区消失），且绝不写盘。
 */
export function loadHandleBindings(): HandleBindings {
  let text: string | null;
  try {
    text = localStorage.getItem(HANDLE_BINDINGS_KEY);
  } catch {
    /* 禁用存储（隐私模式 / 权限收紧）→ 按默认渲染，本轮不因此弹提示 */
    return parseHandleBindings(null);
  }
  if (text == null) return parseHandleBindings(null);
  try {
    return parseHandleBindings(JSON.parse(text));
  } catch {
    /* 坏 JSON：当作没配置，原值留在盘上不覆盖 */
    return parseHandleBindings(null);
  }
}

/**
 * 保存手柄绑定。**先 parse 再写**：落盘的永远是归一化后的形状（`version: 1`），
 * 这样「写的一方」与「读的一方」共用同一套规则，不会出现「存进去能存、读出来变样」。
 */
export function saveHandleBindings(bindings: HandleBindings): void {
  const normalized = parseHandleBindings({ version: 1, forms: bindings });
  const doc: StoredHandleBindings = { version: 1, forms: normalized };
  try {
    localStorage.setItem(HANDLE_BINDINGS_KEY, JSON.stringify(doc));
  } catch (err) {
    /* 写失败不能静默：用户改完设置却在药丸上看不到效果，比报错更难查 */
    console.warn('[handles] 手柄绑定保存失败，本次改动没有落盘', err);
  }
}
