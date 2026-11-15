import { useActivityDisplayColor } from "../hooks/useActivityDisplayColor.ts";
import type { CSSProperties, ReactNode } from "react";

export interface QuietChartTooltipItem {
  color?: string;
  key: string;
  name: ReactNode;
  value: ReactNode;
}

interface Props {
  className?: string;
  fixedBottom?: boolean;
  items: readonly QuietChartTooltipItem[];
  label?: ReactNode;
  style?: CSSProperties;
}

export default function QuietChartTooltip({
  className = "",
  fixedBottom = false,
  items,
  label,
  style,
}: Props) {
  const displayColor = useActivityDisplayColor();
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`at-chart-tooltip${fixedBottom ? " at-chart-tooltip-fixed-bottom" : ""} ${className}`}
      role="tooltip"
      style={style}
    >
      {label !== null && label !== undefined && label !== "" ? (
        <div className="at-chart-tooltip-label">{label}</div>
      ) : null}
      <ul className="at-chart-tooltip-list">
        {items.map((item) => (
          <li key={item.key} className="at-chart-tooltip-item">
            <span className="at-chart-tooltip-key">
              <span
                className="at-chart-tooltip-dot"
                style={{ backgroundColor: item.color ? displayColor(item.color) : "var(--at-accent-default)" }}
              />
              <span className="at-chart-tooltip-name">{item.name}</span>
            </span>
            <span className="at-chart-tooltip-value">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
