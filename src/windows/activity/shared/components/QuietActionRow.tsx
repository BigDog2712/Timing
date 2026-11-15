import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

export default function QuietActionRow({ children, className }: Props) {
  return (
    <div className={`at-action-row ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
