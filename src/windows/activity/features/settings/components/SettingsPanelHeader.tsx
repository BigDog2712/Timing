import type { ReactNode } from "react";

interface SettingsPanelHeaderProps {
  icon: ReactNode;
  title: string;
  className?: string;
}

export default function SettingsPanelHeader({
  icon,
  title,
  className,
}: SettingsPanelHeaderProps) {
  return (
    <div className={`flex items-center gap-2.5 border-b border-[var(--at-border-subtle)] pb-2 ${className ?? ""}`.trim()}>
      {icon}
      <h2 className="at-text-section-title at-weight-emphasis text-[var(--at-text-primary)]">{title}</h2>
    </div>
  );
}
