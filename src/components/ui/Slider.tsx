/**
 * TickBar — 滑杆 Slider（[V0.2.2] 设置面板的外观调节）
 * -----------------------------------------------------------------------------
 * 原生 input[type=range]：键盘左右键可达、无需自绘拖拽逻辑；外观全部走 CSS 令牌。
 * 不透明度用 0–1 区间（默认），[V0.3.4] 起的「最短记录时长」用秒（`min` / `max` / `step`
 * 由调用方给），百分比 / 秒数文案一律由调用方决定——本组件只负责产出数字。
 */
interface SliderProps {
  value: number;
  onChange: (next: number) => void;
  label: string;
  /** 下限（默认 0 = 全透） */
  min?: number;
  /** 上限（默认 1 = 完全不透明；秒数场景由调用方覆盖） */
  max?: number;
  step?: number;
}

export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05 }: SliderProps) {
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
