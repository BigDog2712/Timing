/**
 * Timing — 底部快捷键提示行（panel.md §1）
 * -----------------------------------------------------------------------------
 * 11px mono，键名 ALL CAPS + 字距 --tracking-caps，色 --meta。
 * 提示的是**真实生效**的本地键盘行为（面板内 Enter 提交，Esc 取消）。
 */
import { KeyboardIcon, iconStroke } from '../../lib/icons';

export function ShortcutHint() {
  return (
    <div className="panel__hint">
      <KeyboardIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
      <span className="panel__hint-item">
        <kbd className="kbd">ENTER</kbd>
        <span>开始计时</span>
      </span>
      <span className="panel__hint-item">
        <kbd className="kbd">ESC</kbd>
        <span>取消</span>
      </span>
    </div>
  );
}
