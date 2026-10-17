/**
 * TickBar — 滑杆 Slider（[V0.2.2] 设置面板的外观调节）
 * -----------------------------------------------------------------------------
 * 原生 input[type=range]：键盘左右键可达、无需自绘拖拽逻辑；外观全部走 CSS 令牌。
 * value 统一 0–1，`step` 决定颗粒度，百分比文案由调用方决定。
 */
interface SliderProps {
  value: number;
  onChange: (next: number) => void;
  label: string;
  /** 下限（默认 0 = 全透） */
  min?: number;
  step?: number;
}

export function Slider({ value, onChange, label, min = 0, step = 0.05 }: SliderProps) {
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={1}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
