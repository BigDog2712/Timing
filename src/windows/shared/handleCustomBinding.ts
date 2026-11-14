/**
 * Timing — 手柄槽位里的**自定义绑定**（[0.13]）
 * -----------------------------------------------------------------------------
 * 一个槽位原来只装「目录里的动作 id」（`note.current` 这种）。现在多两种用户自定义：
 *
 *   launch:<路径>     启动一个用户亲手选中的文件（.exe / .lnk / 文档）
 *   hotkey:<组合键>   向当前前台窗口发送该组合键（`Ctrl+Shift+M`）
 *
 * ## 为什么编码在同一根字符串里，而不是另开 `custom` 字段
 *
 * 槽位值的**所有**消费方都只做一件事：「这个槽有没有绑定」。改成两字段之后，
 * `useHandleGesture` 的「要不要等 250ms 判双击」、`HandleButton` 的 title、
 * `parseSlots` 的归一、设置卡的下拉，每一处都要变成「A 非空 **或** B 非空」——
 * 漏掉任何一处的症状都是**静默**的（双击不再生效 / 下拉显示「无」但按键有反应）。
 * 单根字符串让「有没有绑定」仍然是 `!= null`，一处判据都不必改。
 *
 * ## 前缀是安全的
 *
 * 目录里的 id 全部形如 `note.current`（小写 + 点），永远不含冒号；而这里的两个前缀
 * 都以冒号结尾。所以「是不是自定义绑定」这件事不需要查目录，前缀本身就是判据。
 * 路径里的 `C:\` 出现在**前缀之后**，切分只看开头 7 个字符。
 *
 * ## 零 import
 *
 * 本文件被 `shared/handleBindings.ts`（药丸与设置页共用）直接引用，必须保持纯数据。
 */

export type HandleCustomKind = 'launch' | 'hotkey';

export interface HandleCustomBinding {
  kind: HandleCustomKind;
  /** `launch` = 文件路径；`hotkey` = 组合键文本（由 `lib/hotkey.ts` 解析成 VK 序列） */
  payload: string;
}

/** 前缀即判据（见文件头）。长度固定，避免用 `indexOf` 之类会吃到路径里冒号的写法。 */
export const CUSTOM_BINDING_PREFIX: Record<HandleCustomKind, string> = {
  launch: 'launch:',
  hotkey: 'hotkey:',
};

export function serializeCustomBinding(kind: HandleCustomKind, payload: string): string {
  return `${CUSTOM_BINDING_PREFIX[kind]}${payload}`;
}

/**
 * 解析一个槽位值。不是自定义绑定（内置 id、空串、`null`）一律 `null`。
 *
 * 空载荷算无效：`launch:` 单独一个前缀会渲染成「启动 」，点下去就是一条没头没尾的报错。
 */
export function parseCustomBinding(value: string | null | undefined): HandleCustomBinding | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  for (const kind of ['launch', 'hotkey'] as const) {
    const prefix = CUSTOM_BINDING_PREFIX[kind];
    if (!value.startsWith(prefix)) continue;
    const payload = value.slice(prefix.length).trim();
    return payload.length > 0 ? { kind, payload } : null;
  }
  return null;
}

/** 路径的最后一段（`C:\Apps\x.exe` → `x.exe`；`/usr/bin/x` → `x`）。 */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * 把自定义绑定说成人话。设置卡下拉与手柄 `title` 共用这一处 ——
 * 两处各写一份的话，长路径在一处被截断、另一处没有，看起来像两个不同的绑定。
 */
export function describeCustomBinding(binding: HandleCustomBinding): string {
  return binding.kind === 'launch'
    ? `启动 ${fileNameOf(binding.payload)}`
    : `发送 ${binding.payload}`;
}
