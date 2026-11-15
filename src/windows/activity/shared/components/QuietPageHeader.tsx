import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  titleSuffix?: ReactNode;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
}

export default function QuietPageHeader({
  icon,
  title,
  titleSuffix,
  subtitle,
  rightSlot,
}: Props) {
  return (
    <header className="at-panel at-page-header">
      <div className="at-page-header-left">
        <div className="at-page-header-icon">
          {icon}
        </div>
        <div className="at-page-header-copy">
          <div className="at-page-header-title-row">
            <h1 className="at-page-header-title">{title}</h1>
            {titleSuffix ? titleSuffix : null}
          </div>
          {subtitle ? (
            <div className="at-page-header-subtitle">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {rightSlot ? (
        <div className="at-page-header-right">
          {rightSlot}
        </div>
      ) : null}
    </header>
  );
}
