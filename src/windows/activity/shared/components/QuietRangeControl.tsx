import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef } from "react";

interface QuietRangeControlProps {
  ariaLabel: string;
  label: string;
  labelAriaLabel?: string;
  previousAriaLabel: string;
  nextAriaLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onLabelClick?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  expanded?: boolean;
  labelControls?: string;
  className?: string;
  labelClassName?: string;
}

const QuietRangeControl = forwardRef<HTMLButtonElement, QuietRangeControlProps>(function QuietRangeControl({
  ariaLabel,
  label,
  labelAriaLabel,
  previousAriaLabel,
  nextAriaLabel,
  onPrevious,
  onNext,
  onLabelClick,
  previousDisabled = false,
  nextDisabled = false,
  expanded,
  labelControls,
  className,
  labelClassName,
}, ref) {
  return (
    <div
      className={`at-range-control ${className ?? ""}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={previousDisabled}
        className="at-control at-range-control-arrow"
        aria-label={previousAriaLabel}
      >
        <ChevronLeft size={14} />
      </button>
      {onLabelClick ? (
        <button
          ref={ref}
          type="button"
          className={`at-status at-range-control-label ${labelClassName ?? ""}`.trim()}
          aria-label={labelAriaLabel}
          aria-expanded={expanded}
          aria-haspopup="dialog"
          aria-controls={labelControls}
          onClick={onLabelClick}
        >
          <span className="at-range-control-label-text">{label}</span>
        </button>
      ) : (
        <span
          className={`at-status at-range-control-label ${labelClassName ?? ""}`.trim()}
          aria-label={labelAriaLabel}
        >
          <span className="at-range-control-label-text">{label}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="at-control at-range-control-arrow"
        aria-label={nextAriaLabel}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
});

export default QuietRangeControl;
