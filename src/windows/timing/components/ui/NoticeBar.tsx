/**
 * Timing — 提示条 NoticeBar（轻量、非阻塞；用于 IPC 失败等瞬时反馈）
 * -----------------------------------------------------------------------------
 * 4s 后自动消失；danger 态带 circle-alert（禁用任何 Unicode 警告符号）。
 */
import { useEffect } from 'react';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { useUiStore } from '../../stores/uiStore';

const NOTICE_MS = 4000;

export function NoticeBar() {
  const notice = useUiStore((s) => s.notice);
  const setNotice = useUiStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);

  if (!notice) return null;

  return (
    <div className="notice" data-tone={notice.tone} role="status">
      {notice.tone === 'danger' && <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
      <span>{notice.text}</span>
    </div>
  );
}
