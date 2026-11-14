/**
 * Timing — 组合键的文本化 / 解析 / VK 映射（[0.13] 手柄「发送快捷键」）
 *
 * 放 `windows/shared` 而不是 `timing/lib`：录制框住在**分析窗**的设置页，派发住在主窗，
 * 两边必须用同一份解析（否则「录进去的是 Ctrl+M、发出来的是别的」这种漂移无从发现）。
 * 本文件零 import，符合共享层的纯度要求。
 * -----------------------------------------------------------------------------
 * 三个职责，都必须是**纯函数**（录制框、设置卡、dispatch 三处共用，任何一处另写一份
 * 都会让「录进去的和发出去的」变成两个不同的键）：
 *
 *   1. `specFromKeyboardEvent` —— 一次 keydown → `HotkeySpec`
 *   2. `formatHotkey` / `parseHotkey` —— `HotkeySpec` ↔ 落库文本（`Ctrl+Shift+M`）
 *   3. `hotkeyToVirtualKeys` —— `HotkeySpec` → 后端 `SendInput` 吃的 VK 序列
 *
 * ## 为什么必须有修饰键
 *
 * 这条链最终会往**用户当前的前台应用**注入按键。允许「单键」就等于允许「点一下手柄，
 * 在别人的输入框里打一个字母」——录错一次就是一次无声的误输入。所以 `specFromKeyboardEvent`
 * 与 `parseHotkey` 都要求至少一个修饰键；`hotkeyToVirtualKeys` 再挡一次（纵深防御：
 * 手改过的配置也要被挡住）。
 *
 * ## 为什么用 `event.code` 而不是 `event.key`
 *
 * `key` 受键盘布局与 Shift 影响（`Shift+1` 给 `!`、法语布局给 `&`），而 VK 是**物理键位**。
 * 用 `key` 拼出来的文本会在换布局后指向另一个键 —— 表现为「录的是 1、发出来的是别的」。
 */

export interface HotkeySpec {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** 主键的显示名（`A` / `1` / `F12` / `Space`），不是 `code` */
  key: string;
}

interface HotkeyKey {
  /** `KeyboardEvent.code`（物理键位） */
  code: string;
  /** 显示名，也是落库文本里那一段 */
  name: string;
  /** Win32 虚拟键码 */
  vk: number;
}

/** 修饰键的 VK。顺序 = 落库文本与发送顺序（**同一条**，两处不同会让日志与行为对不上）。 */
const MODIFIER_KEYS: readonly { flag: 'ctrl' | 'alt' | 'shift' | 'meta'; name: string; vk: number }[] = [
  { flag: 'ctrl', name: 'Ctrl', vk: 0x11 },
  { flag: 'alt', name: 'Alt', vk: 0x12 },
  { flag: 'shift', name: 'Shift', vk: 0x10 },
  { flag: 'meta', name: 'Meta', vk: 0x5b },
];

/** 把 `Ctrl` / `Control` / `Ctrl键` 这类写法都收进同一个修饰位。 */
const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  win: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
};

/** 主键表：`code` → 显示名 + VK。字母/数字/功能键用循环生成，其余逐条列（顺序即解析优先级）。 */
function buildKeyTable(): HotkeyKey[] {
  const table: HotkeyKey[] = [];
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    table.push({ code: `Key${letter}`, name: letter, vk: 0x41 + i });
  }
  for (let digit = 0; digit <= 9; digit += 1) {
    table.push({ code: `Digit${digit}`, name: String(digit), vk: 0x30 + digit });
  }
  for (let fn = 1; fn <= 24; fn += 1) {
    table.push({ code: `F${fn}`, name: `F${fn}`, vk: 0x70 + fn - 1 });
  }
  table.push(
    { code: 'Space', name: 'Space', vk: 0x20 },
    { code: 'Tab', name: 'Tab', vk: 0x09 },
    { code: 'Enter', name: 'Enter', vk: 0x0d },
    { code: 'Escape', name: 'Esc', vk: 0x1b },
    { code: 'Backspace', name: 'Backspace', vk: 0x08 },
    { code: 'Delete', name: 'Delete', vk: 0x2e },
    { code: 'Insert', name: 'Insert', vk: 0x2d },
    { code: 'Home', name: 'Home', vk: 0x24 },
    { code: 'End', name: 'End', vk: 0x23 },
    { code: 'PageUp', name: 'PageUp', vk: 0x21 },
    { code: 'PageDown', name: 'PageDown', vk: 0x22 },
    { code: 'ArrowUp', name: 'Up', vk: 0x26 },
    { code: 'ArrowDown', name: 'Down', vk: 0x28 },
    { code: 'ArrowLeft', name: 'Left', vk: 0x25 },
    { code: 'ArrowRight', name: 'Right', vk: 0x27 },
    /* 符号键用**未按下 Shift 的那个字符**当名字：`+` 是分隔符，绝不能出现在键名里 */
    { code: 'Minus', name: '-', vk: 0xbd },
    { code: 'Equal', name: '=', vk: 0xbb },
    { code: 'BracketLeft', name: '[', vk: 0xdb },
    { code: 'BracketRight', name: ']', vk: 0xdd },
    { code: 'Backslash', name: '\\', vk: 0xdc },
    { code: 'Semicolon', name: ';', vk: 0xba },
    { code: 'Quote', name: "'", vk: 0xde },
    { code: 'Comma', name: ',', vk: 0xbc },
    { code: 'Period', name: '.', vk: 0xbe },
    { code: 'Slash', name: '/', vk: 0xbf },
    { code: 'Backquote', name: '`', vk: 0xc0 },
  );
  return table;
}

const KEY_TABLE = buildKeyTable();
const KEY_BY_CODE = new Map(KEY_TABLE.map((entry) => [entry.code, entry]));
/** 名字**小写**查表：落库文本区分大小写不是用户的意图，`ctrl+m` 与 `Ctrl+M` 是同一个组合。 */
const KEY_BY_NAME = new Map(KEY_TABLE.map((entry) => [entry.name.toLowerCase(), entry]));

function hasModifier(spec: HotkeySpec): boolean {
  return spec.ctrl || spec.alt || spec.shift || spec.meta;
}

/**
 * 一次 keydown → `HotkeySpec`。
 *
 * 返回 `null` 的三种情况都**不是错误**，录制框靠它判断「继续等下一个键」：
 *  - 按的是修饰键本身（`ShiftLeft` 不在主键表里）
 *  - 按的键不在白名单（媒体键 / IME 键 / 小键盘 —— 它们的 VK 语义随设备变化）
 *  - 没有修饰键（只有主键，见文件头「为什么必须有修饰键」）
 */
export function specFromKeyboardEvent(event: KeyboardEvent): HotkeySpec | null {
  const hit = KEY_BY_CODE.get(event.code);
  if (!hit) return null;
  const spec: HotkeySpec = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: hit.name,
  };
  return hasModifier(spec) ? spec : null;
}

/** `HotkeySpec` → 落库文本。修饰位按固定顺序，保证同一组合只有一种写法。 */
export function formatHotkey(spec: HotkeySpec): string {
  const parts = MODIFIER_KEYS.filter((modifier) => spec[modifier.flag]).map((modifier) => modifier.name);
  return [...parts, spec.key].join('+');
}

/**
 * 落库文本 → `HotkeySpec`。不合法（缺修饰键 / 认不出主键 / 空串）一律 `null`。
 *
 * 宽容度：分割符两侧空白、修饰键别名（`Control` / `Win` / `Cmd`）、键名大小写。
 * 不宽容的是「没有修饰键」—— 那是危险配置，不能被静默接受。
 */
export function parseHotkey(text: string): HotkeySpec | null {
  const segments = text
    .split('+')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;

  const spec: HotkeySpec = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const modifier = MODIFIER_ALIASES[segment.toLowerCase()];
    const isLast = i === segments.length - 1;
    if (modifier) {
      /* 修饰键出现在最后一段 = 这个组合没有主键（`Ctrl+Shift+`） */
      if (isLast) return null;
      spec[modifier] = true;
      continue;
    }
    /* 非末段的普通键名 = 两个主键（`Ctrl+M+N`），不猜哪个才是主键 */
    if (!isLast) return null;
    const hit = KEY_BY_NAME.get(segment.toLowerCase());
    if (!hit) return null;
    spec.key = hit.name;
  }
  return hasModifier(spec) && spec.key.length > 0 ? spec : null;
}

/**
 * `HotkeySpec` → 交给后端的 VK 序列（修饰键在前、主键在最后）。
 *
 * 后端只按顺序 `keybd_event` 按下、逆序抬起 —— 键名表只存在这一份，所以「录的是 M、
 * 发出来的是 N」这种漂移在结构上就不可能发生。
 */
export function hotkeyToVirtualKeys(spec: HotkeySpec): number[] {
  if (!hasModifier(spec)) return [];
  const mainKey = KEY_BY_NAME.get(spec.key.toLowerCase());
  if (!mainKey) return [];
  const modifiers = MODIFIER_KEYS.filter((modifier) => spec[modifier.flag]).map((modifier) => modifier.vk);
  return [...modifiers, mainKey.vk];
}
