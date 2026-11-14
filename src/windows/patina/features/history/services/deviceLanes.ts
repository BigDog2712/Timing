/**
 * 设备泳道的**装配规则**（纯函数，零 React / 零 IO）。
 *
 * 这里有一条硬边界：**设备数 ≤ 1 时返回空数组**。
 *
 * 为什么把这件事放在数据层而不是渲染层写 `if (devices.length > 1)`：单设备时"界面不许
 * 出现任何设备元素"（design §6.5）是一条验收断言，如果它散在各个组件的三元表达式里，
 * 下次有人加一个 `<DeviceChip />` 就会漏掉一处，而且不会有任何用例变红。放在这里之后，
 * 「有几台设备」只有一个答案，组件只需要问 `lanes.length > 0`。
 *
 * 排序：**本机第一**，其余按 `install_id` 升序。不按"会话多少"排——刚导入完的历史会
 * 让手机排在前面，用户看到的第一行不是自己这台机器。
 */
import { deviceShortLabel } from "../../../shared/lib/deviceColor.ts";

export interface DeviceLane {
  deviceId: string;
  isSelf: boolean;
  /** 短 id（12 位取前 6 位）；「本机」这个称呼由调用方按文案表决定，不在这里拼中文 */
  label: string;
}

export interface DeviceSessionLike {
  deviceId?: string;
}

/**
 * 从会话里归纳出设备泳道。**≤1 台时返回 `[]`**（`[]` = 不许渲染设备元素）。
 *
 * `selfDeviceId` 由后端给（`HistoryRangeRows.selfDeviceId`），不让前端猜：
 * 手机导入的数据全被折成本机 id，"出现过"与"是本机"是两件事。
 */
export function buildDeviceLanes(
  sessions: readonly DeviceSessionLike[],
  selfDeviceId: string | null | undefined,
): DeviceLane[] {
  const ids = new Set<string>();
  for (const session of sessions) {
    const id = session.deviceId?.trim();
    if (id) ids.add(id);
  }
  if (ids.size < 2) return [];
  const self = selfDeviceId && ids.has(selfDeviceId) ? selfDeviceId : null;
  const others = [...ids].filter((id) => id !== self).sort();
  const ordered = self ? [self, ...others] : others;
  return ordered.map((deviceId) => ({
    deviceId,
    isSelf: deviceId === self,
    label: deviceShortLabel(deviceId),
  }));
}
