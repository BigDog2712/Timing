import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleX, Info } from "lucide-react";
import type { QuietToastTone } from "../types/toast";

interface Props {
  message: string;
  tone: QuietToastTone;
}

function resolveToastTone(tone: QuietToastTone): { icon: ReactNode; className: string } {
  if (tone === "success") {
    return {
      icon: <CheckCircle2 size={14} className="text-[var(--at-success)]" />,
      className: "at-toast-success",
    };
  }

  if (tone === "warning") {
    return {
      icon: <AlertCircle size={14} className="text-[var(--at-warning)]" />,
      className: "at-toast-warning",
    };
  }

  if (tone === "error") {
    return {
      icon: <CircleX size={14} className="text-[var(--at-danger)]" />,
      className: "at-toast-error",
    };
  }

  return {
    icon: <Info size={14} className="text-[var(--at-accent-default)]" />,
    className: "at-toast-info",
  };
}

export default function QuietToast({ message, tone }: Props) {
  const toneMeta = resolveToastTone(tone);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={`at-toast ${toneMeta.className}`}
    >
      <div className="at-toast-content">
        <span className="at-toast-icon">{toneMeta.icon}</span>
        <span className="at-toast-message">{message}</span>
      </div>
    </div>
  );
}
