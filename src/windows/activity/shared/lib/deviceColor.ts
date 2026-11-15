/**
 * 设备色的**唯一**实现（design §6.4）。
 *
 * 规则：`install_id` 的 FNV-1a 32 位哈希 → `hash % 8` 索引 8 个颜色令牌。
 * 两台机器对同一台设备必然取到同一个颜色，所以颜色**不需要同步**，也不落库。
 *
 * ## 返回的是令牌名，不是色值
 *
 * 上一版这里直接返回 `hsl(212 62% 52%)`。那等于把字面量色值换了个地方写：
 * 主题切换时它不跟随（深底上发闷）、设计侧改色要翻 TypeScript、项目
 * 「样式只用 `var(--*)` 令牌」的硬约束被绕过。现在只返回 `var(--at-device-N)`，
 * 真正的色值（浅/深两套）在 `shell/styles/features/device-lanes.css` 里。
 *
 * `shell/styles/tokens.css` 压在 298/298 冻结线上，所以那 8 个令牌没有进 tokens.css
 * 而是单开了一份 features 文件——与 `history-range.css` / `timing-lane.css` 同一处置。
 */
const DEVICE_TOKEN_COUNT = 8;

/** FNV-1a 32 位（与 Rust 侧同算法；若将来导出设备色，两边必须逐位相同） */
export function fnv1a32(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    /* `Math.imul` 是唯一能做 32 位乘法回绕的写法；`hash * 16777619` 会掉精度 */
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash >>> 0;
}

/** 设备色令牌序号 `0..7`（确定性派生）。 */
export function deviceColorIndex(deviceId: string): number {
  return fnv1a32(deviceId.trim()) % DEVICE_TOKEN_COUNT;
}

/**
 * 设备色（确定性派生）——**只返回令牌引用**。
 *
 * 空 id 给中性文本令牌，不参与色相轮盘：一个"没有身份"的设备不该占用一个颜色槽。
 */
export function deviceColor(deviceId: string): string {
  const id = deviceId.trim();
  if (!id) return "var(--at-text-tertiary)";
  return `var(--at-device-${deviceColorIndex(id)})`;
}

/** 设备短名：12 位 hex 取前 6 位。够区分（同机群的 install_id 前缀随机），又不占宽。 */
export function deviceShortLabel(deviceId: string): string {
  const id = deviceId.trim();
  return id.length <= 6 ? id : id.slice(0, 6);
}

/** 令牌总数（用例与将来加色时对齐用） */
export const DEVICE_COLOR_TOKENS = DEVICE_TOKEN_COUNT;
