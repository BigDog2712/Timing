import { deviceColor, deviceShortLabel } from "../../../shared/lib/deviceColor.ts";

/**
 * 设备 chip：一个小圆点 + 名称。
 *
 * 只在**多设备**时出现——单设备时调用方根本不渲染它（`buildDeviceLanes` 返回空数组，
 * `DeviceLegend` 返回 `null`，时间轴也不打 `device-lane`）。这不是"藏起来"，是压根没有节点。
 *
 * 版式在 `shell/styles/features/device-lanes.css`，颜色只来自 `deviceColor()`（令牌引用）。
 */
interface Props {
  deviceId: string;
  isSelf: boolean;
  /** 「本机」这个称呼来自文案表，组件不拼中文 */
  selfLabel: string;
}

export default function DeviceChip({ deviceId, isSelf, selfLabel }: Props) {
  return (
    <span
      className="qp-badge qp-badge-compact qp-badge-neutral device-chip"
      data-testid="device-chip"
      data-device-id={deviceId}
      title={deviceId}
    >
      <span
        aria-hidden="true"
        className="device-chip-dot"
        style={{ background: deviceColor(deviceId) }}
      />
      {isSelf ? selfLabel : deviceShortLabel(deviceId)}
    </span>
  );
}
