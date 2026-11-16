import { useLocaleText } from "../../../shared/i18n/index.ts";
import { FileText, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import appIconUrl from "../../../../../../src-tauri/icons/icon.png";
import QuietButton from "../../../shared/components/QuietButton";

/* [O3 2026-11-16] 版本卡片下方原本有一块 `UpdateStatusPanel`（检查更新 / 下载进度 /
   安装按钮）。整条更新通道已删除，这块随之移除；**保留**的三个入口（GitHub / 更新日志 /
   反馈）与更新无关，走的是浏览器打开链接。 */
type AboutPanelProps = {
  appVersion: string;
  onOpenReleaseNotes: () => void;
  onOpenRepository: () => void;
  onOpenFeedback: () => void;
};

type AboutLinkButtonProps = {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
};

function AboutLinkButton({
  icon,
  label,
  onClick,
}: AboutLinkButtonProps) {
  return (
    <QuietButton
      size="compact"
      className="about-pill-action"
      onClick={onClick}
    >
      <span className="about-pill-icon" aria-hidden>
        {icon}
      </span>
      <span className="about-pill-label">{label}</span>
    </QuietButton>
  );
}

export default function AboutPanel({
  appVersion,
  onOpenReleaseNotes,
  onOpenRepository,
  onOpenFeedback,
}: AboutPanelProps) {
  const UI_TEXT = useLocaleText();
  const versionLabel = appVersion === "-" || appVersion === "unknown"
    ? UI_TEXT.about.versionUnknown
    : `v${appVersion}`;
  return (
    <div className="about-center-workbench">
      <section className="at-panel about-center-panel">
        <div className="about-center-profile">
          <div className="about-center-icon-shell" aria-hidden>
            <img src={appIconUrl} alt="" draggable={false} />
          </div>
          <div className="about-center-title-row">
            <h2>Timing</h2>
            <span className="about-center-version at-text-caption at-weight-emphasis">{versionLabel}</span>
          </div>
          <p>{UI_TEXT.about.description}</p>
        </div>

        <div className="about-pill-row">
          <AboutLinkButton
            icon={<span className="about-github-mark" />}
            label={(
              <>
                GitHub <span className="about-github-star-label">Star</span>
              </>
            )}
            onClick={onOpenRepository}
          />
          <AboutLinkButton
            icon={<FileText size={14} />}
            label={UI_TEXT.update.releaseNotes}
            onClick={onOpenReleaseNotes}
          />
          <AboutLinkButton
            icon={<MessageSquare size={14} />}
            label={UI_TEXT.update.feedback}
            onClick={onOpenFeedback}
          />
        </div>

      </section>
    </div>
  );
}
