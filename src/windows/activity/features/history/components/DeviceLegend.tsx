import { deviceColor } from "../../../shared/lib/deviceColor.ts";
import type { DeviceLane } from "../services/deviceLanes.ts";

/**
 * 设备图例：多设备时列出"哪台是哪色"。
 *
 * **单设备时返回 `null`**（`lanes` 为空）——design §6.5 的"无图例"是节点不存在，
 * 不是 `display:none`。用例断言的是 `queryAllByTestId('device-legend')` 为 null /
 * `queryAllByTestId('device-chip')` 长度 0，藏起来过不了。
 *
 * 版式与色值都在 `shell/styles/features/device-lanes.css`（`--qp-device-0..7`）。
 */
interface Props {
  lanes: DeviceLane[];
  selfLabel: string;
  title: string;
}

export default function DeviceLegend({ lanes, selfLabel, title }: Props) {
  if (lanes.length === 0) return null;
  return (
    <ul className="device-legend" data-testid="device-legend" aria-label={title}>
      {lanes.map((lane) => (
        <li
          key={lane.deviceId}
          className="device-legend-item"
          data-testid="device-legend-item"
          data-device-id={lane.deviceId}
          title={lane.deviceId}
        >
          <span
            aria-hidden="true"
            className="device-legend-dot"
            style={{ background: deviceColor(lane.deviceId) }}
          />
          {lane.isSelf ? selfLabel : lane.label}
        </li>
      ))}
    </ul>
  );
}
