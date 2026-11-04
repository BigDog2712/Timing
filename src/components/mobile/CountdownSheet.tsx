/**
 * TickBar — 定长倒计时 Sheet
 * -----------------------------------------------------------------------------
 * 交互口径（PRD U7「重复动作不超过两下」）：点一档预设**立刻开始**，不需要再点确认。
 * 自定义分钟数才需要一次「开始」——那一次点击同时承担「申请通知权限」的手势上下文。
 *
 * 倒计时到点恒为结束并保存（ADR-023，无开关），所以这里也没有「到点提醒 / 自动结束」
 * 之类的选项，只给时长。
 */
import { useState } from 'react';
import { MAX_COUNTDOWN_SEC } from '../../types/domain';
import { countdownActions } from '../../services/countdownActions';
import { ensureNotifyPermission } from '../../services/mobileNotify';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { minutesToSec } from '../../lib/mobileTime';
import { Sheet } from './Sheet';

const MAX_MINUTES = MAX_COUNTDOWN_SEC / 60;

export function CountdownSheet() {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const presets = useSettingsStore((s) => s.settings.countdownPresets);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const itemId = status === 'idle' ? null : (session?.itemId ?? null);
  const replace = status !== 'idle';

  const start = async (targetSec: number) => {
    if (busy || targetSec <= 0 || targetSec > MAX_COUNTDOWN_SEC) return;
    setBusy(true);
    /* 申请权限与「开始」绑在同一次点击里：系统弹窗必须有手势上下文 */
    void ensureNotifyPermission();
    try {
      await countdownActions.start(itemId ?? undefined, targetSec, replace);
    } finally {
      setBusy(false);
      closeSheet();
    }
  };

  const customSec = minutesToSec(Number(draft));
  const customValid = Number.isFinite(customSec) && customSec >= 60 && customSec <= MAX_COUNTDOWN_SEC;
  const alreadyPreset = presets.includes(customSec);

  const savePreset = async () => {
    if (!customValid || alreadyPreset) return;
    try {
      const saved = await countdownActions.setPresets([...presets, customSec].sort((a, b) => a - b));
      const settings = useSettingsStore.getState().settings;
      useSettingsStore.getState().setSettings({ ...settings, countdownPresets: saved });
    } catch {
      /* 存预设失败不影响这次倒计时；用户重开面板能看到没存上 */
    }
  };

  return (
    <Sheet
      title="倒计时"
      onClose={closeSheet}
      footer={
        <div className="m-sheet__foot-row">
          <label className="m-field m-field--grow">
            <span className="m-field__label">自定义分钟</span>
            <input
              className="m-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_MINUTES}
              step={1}
              value={draft}
              placeholder="例如 25"
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="m-btn m-btn--primary"
            disabled={!customValid || busy}
            onClick={() => void start(customSec)}
          >
            开始
          </button>
        </div>
      }
    >
      {replace && (
        <p className="m-hint">
          当前正在计时：开始倒计时会先结束并保存这一段（不足最短记录时长则不记录）。
        </p>
      )}

      <div className="m-grid m-grid--preset">
        {presets.map((sec) => (
          <button
            key={sec}
            type="button"
            className="m-preset"
            disabled={busy}
            onClick={() => void start(sec)}
          >
            {Math.round(sec / 60)}
            <span className="m-preset__unit">分钟</span>
          </button>
        ))}
      </div>

      {customValid && !alreadyPreset && (
        <button type="button" className="m-btn m-btn--ghost m-btn--wide" onClick={() => void savePreset()}>
          把 {Math.round(customSec / 60)} 分钟存为常用档位
        </button>
      )}

      <p className="m-hint">到点会自动结束并保存，并发出系统通知。</p>
    </Sheet>
  );
}
