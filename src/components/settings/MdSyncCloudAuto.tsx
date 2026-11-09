/**
 * Timing — 设置 · 同步 · 「自动同步」三档控件（V0.11.19 批 1；[V0.11.26] props 化）
 * -----------------------------------------------------------------------------
 * 块④/⑤ 各挂一份实例（PRD R5：三档每块各一份，值独立存），所以这个组件**不再认识
 * `draft`**——它只收 `{ auto, disabled, onChange }`：值与开关由调用方给，
 * 改动由调用方落库。两块用同一份组件、同形同文案，但**是两个 value**。
 *
 * 三条硬约束：
 * 1. 类名只用 `sync-cloud__hint` 系，**不许**用 `data__block-hint` / `data__note` /
 *    `sync__hint` —— 后三个被 `mdSyncA1.test.tsx` 的「每块恰好一句」判据钉死；
 * 2. 分段按钮**不许**用 `.seg__item` / `data-on`：`mdSyncR2.test.tsx` 按那个类数按钮；
 * 3. 通路关着时三档 `disabled`，**值保留**（草稿里那份 `auto` 一个字节不清，D7）。
 *
 * 数字框「打字只改文本、失焦/回车才夹值」是刻意的两段式：若每次按键都夹到 5，
 * 用户就没法输入 `15`（敲下 `1` 的瞬间已被改成 `5`）。
 */
import { useState } from 'react';
import type { CloudSchedule, MdSyncCloudAuto as MdCloudAutoValue } from '../../types/domain';
import {
  AUTO_MAX_MINUTES,
  AUTO_MIN_MINUTES,
  autoOf,
  clampAutoMinutes,
} from './mdSyncAuto';
import { AUTO_COPY } from './mdSyncCopy';

interface MdSyncCloudAutoProps {
  /** 这条通路自己的三档配置（`undefined` / `null` = 老配置，读作默认「智能 + 15」） */
  auto: MdCloudAutoValue | undefined | null;
  /** `true` = 这条通路关着（或正在保存）：全部可写控件禁用、值保留 */
  disabled: boolean;
  /** 用户真的动过控件才回调；渲染期绝不回调（老配置逐字节不变） */
  onChange: (next: MdCloudAutoValue) => void;
  /**
   * [V0.11.26] 分钟框的 aria-label 要能区分两块（同一屏里两个「自动同步」）。
   * 默认沿用块⑤ 的那句，块④ 传自己的那句。
   *
   * [V0.11.26] 措辞从「…同步间隔（分钟）」改成「…同步周期（分钟）」：`REMOVED_PHRASES`
   * 里钉着 `同步间隔` 这条零命中判据（它属于 V0.11.19 删掉的 ③「同步间隔」整行），
   * 而 `mdSyncV0118RedAndCopy` 的 F1 会把**每个 `aria-label`** 也搜一遍。两块现在
   * 恒挂载（折叠也挂载），旧措辞会让那条判据红在一个跟它无关的控件上。
   * 手机端 `SyncCloudPane` 仍是旧措辞——那是零 diff 红线，且不被这条判据扫到。
   */
  minutesLabel?: string;
}

const SCHEDULES: CloudSchedule[] = ['off', 'interval', 'smart'];
const LABELS: Record<CloudSchedule, string> = {
  off: AUTO_COPY.off,
  interval: AUTO_COPY.interval,
  smart: AUTO_COPY.smart,
};

export function MdSyncCloudAuto({
  auto: value,
  disabled,
  onChange,
  minutesLabel = '云端自动同步周期（分钟）',
}: MdSyncCloudAutoProps) {
  const auto = autoOf(value);
  const [minutesText, setMinutesText] = useState<string | null>(null);

  const patch = (next: Partial<MdCloudAutoValue>) => onChange({ ...auto, ...next });
  const choose = (schedule: CloudSchedule) => {
    setMinutesText(null);
    /* 只改 `schedule`，`intervalMinutes` 由展开的 `auto` 原样带过（H-2）。 */
    patch({ schedule });
  };
  const commitMinutes = (raw: string) => {
    setMinutesText(null);
    patch({ intervalMinutes: clampAutoMinutes(raw) });
  };

  return (
    <div className="sync-cloud__auto" data-disabled={disabled ? 'true' : 'false'}>
      <span className="sync-cloud__auto-label">{AUTO_COPY.label}</span>
      <div className="sync-cloud__auto-tiers" role="group" aria-label={AUTO_COPY.label}>
        {SCHEDULES.map((schedule) => (
          <button
            key={schedule}
            type="button"
            className="sync-cloud__auto-item"
            data-tier={schedule}
            aria-pressed={auto.schedule === schedule}
            disabled={disabled}
            onClick={() => choose(schedule)}
          >
            {LABELS[schedule]}
          </button>
        ))}
      </div>

      {auto.schedule === 'interval' && (
        <div className="sync-cloud__auto-interval">
          <span className="sync-cloud__hint">{AUTO_COPY.every}</span>
          <label className="num-field">
            <input
              className="num-field__input"
              type="number"
              inputMode="numeric"
              min={AUTO_MIN_MINUTES}
              max={AUTO_MAX_MINUTES}
              step={1}
              value={minutesText ?? String(auto.intervalMinutes)}
              aria-label={minutesLabel}
              title="输入分钟数后回车或点别处生效"
              disabled={disabled}
              onChange={(event) => {
                const text = event.target.value;
                setMinutesText(text);
                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed)) patch({ intervalMinutes: parsed });
              }}
              onBlur={(event) => commitMinutes(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitMinutes(event.currentTarget.value);
                }
              }}
            />
            <span className="sync-cloud__hint">{AUTO_COPY.minutes}</span>
          </label>
          <span className="sync-cloud__hint">{AUTO_COPY.range}</span>
        </div>
      )}

      {auto.schedule === 'smart' && (
        <p className="sync-cloud__hint">{AUTO_COPY.smartNote}</p>
      )}
    </div>
  );
}
