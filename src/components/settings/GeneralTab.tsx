/**
 * TickBar — 设置 · 通用页签（settings-panel.md §3.1「通用」）
 * -----------------------------------------------------------------------------
 * 行骨架统一「左标签 + 右控件」（全页一条竖向对齐轴）。
 *
 * V0.3.4 起只剩两个**行为**设置：
 *   - 开机自启（写注册表，P0-6）
 *   - 最短记录时长（`timing.min_record_seconds`，默认 30 秒；低于此时长的手动结束、
 *     以及切换事项产生的分段都不产生记录，见 ADR-023）
 * 「倒计时到点自动结束并保存」开关已删除——到点恒为保存（用户设了目标就该落一条记录）。
 * 显示类设置（文字 / 背景不透明度、高亮颜色）在「外观配色」页签；
 * 「保持窗口置顶」「感知壁纸自动提高不透明度」「全局快捷键」三块见 ADR-022。
 *
 * [V0.3.5] 最短记录时长由滑杆改为**数字输入框**：这一行要的是一个准确秒数，
 * 滑杆在 5–300 区间里按 5 秒一格，想填 47 得先算清落在第几格，反而不如直接敲。
 * 输入框只留「数字 + S」，不缀「低于此时长不记录」这类说明。
 */
import { useEffect, useState } from 'react';
import { errorText } from '../../services/ipc';
import { settingsActions } from '../../services/settingsActions';
import { useSettingsStore } from '../../stores/settingsStore';
import { Switch } from '../ui/Switch';

/** 最短记录时长：与后端 `ReferenceSettings::default().min_record_seconds` 同值 */
const FALLBACK_MIN_RECORD_SEC = 30;
/** 可调范围（秒）：下限 5 秒已低于任何有意义的记录，上限 5 分钟 */
const MIN_RECORD_SEC_MIN = 5;
const MIN_RECORD_SEC_MAX = 300;

function clampSec(value: number): number {
  return Math.min(MIN_RECORD_SEC_MAX, Math.max(MIN_RECORD_SEC_MIN, value));
}

interface GeneralTabProps {
  /**
   * 是否显示「开机自启」。移动端传 false（PRD §5 D4：Android 无等价语义，
   * 后端 get_settings 恒返回 false，留一个点了没反应的开关等于骗人）。
   * 桌面不传 = true，行为与样式完全不变。
   */
  showAutostart?: boolean;
}

export function GeneralTab({ showAutostart = true }: GeneralTabProps) {
  const settings = useSettingsStore((s) => s.settings);
  const referenceSettings = useSettingsStore((s) => s.referenceSettings);
  const [error, setError] = useState<string | null>(null);

  /* 「参考设置」不在首帧就绪：先拉一次，避免输入框先显示兜底值再跳（同 AppearanceCard）。 */
  useEffect(() => {
    if (referenceSettings) return;
    void useSettingsStore
      .getState()
      .reloadReference()
      .catch(() => undefined);
  }, [referenceSettings]);

  const minRecordSeconds = referenceSettings?.minRecordSeconds ?? FALLBACK_MIN_RECORD_SEC;

  /* 输入中的草稿（字符串）：受控 input 的值来自 store，直接绑数字会让「清空重打」
  和「打了一半的负号」被立刻纠正回去。草稿只负责编辑态，提交后交还 store。 */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(minRecordSeconds);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  /* 失焦 / 回车才提交：空值或非数字一律回退到当前值（不写库），
     越界钳到 5 / 300，其余按输入的原样保存（不强制 5 的整数倍）。 */
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (trimmed === '' || !Number.isFinite(parsed)) {
      setDraft(null);
      return;
    }
    const next = clampSec(parsed);
    setDraft(String(next));
    if (next === minRecordSeconds) {
      setDraft(null);
      return;
    }
    void run(async () => {
      try {
        await settingsActions.updateReferenceSettings({ minRecordSeconds: next });
      } finally {
        setDraft(null);
      }
    });
  };

  return (
    <div className="setting-group">
      {showAutostart && (
        <div className="setting-row">
          <span className="setting-row__label">开机自启</span>
          <Switch
            label="开机自启"
            checked={settings.autostartEnabled}
            onChange={(v) => void run(() => settingsActions.setAutostart(v))}
          />
        </div>
      )}

      <div className="setting-row">
        <span className="setting-row__label">最短记录时长</span>
        <label className="num-field">
          <input
            className="num-field__input"
            type="number"
            inputMode="numeric"
            min={MIN_RECORD_SEC_MIN}
            max={MIN_RECORD_SEC_MAX}
            step={1}
            value={shown}
            aria-label="最短记录时长（秒）"
            title="输入秒数后回车或点别处生效"
            onChange={(e) => setDraft(e.target.value)}
            /* [V0.3.9] 不再「聚焦即全选」：用户反馈进来调秒数时整段文字被反白高亮，
               看着像选中了别的东西；现在按点到的位置落光标，要整段改自己拖选。 */
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(e.currentTarget.value);
              }
            }}
          />
          <span className="num-field__unit">S</span>
        </label>
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
