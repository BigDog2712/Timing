/**
 * Timing — 设置 · 同步 · 块④「自动同步」三档控件（V0.11.19 批 1）
 * -----------------------------------------------------------------------------
 * `MdSyncCloudCard.tsx` 已 269 行，塞不下三档 + 定时数字框 + 两句说明，所以另起文件，
 * 挂在 `.sync__fields` 的**第一个子节点**（原「启用云端通道」Switch 那一行腾出的位置）。
 *
 * 三条硬约束：
 * 1. 类名只用 `sync-cloud__hint` 系，**不许**用 `data__block-hint` / `data__note` /
 *    `sync__hint` —— 后三个被 `mdSyncA1.test.tsx` 的「每块恰好一句」判据钉死；
 * 2. 分段按钮**不许**用 `.seg__item` / `data-on`：块④ 里已有一个载体分段，
 *    `MdSyncCloudCard.test.tsx` 与 `mdSyncR2.test.tsx` 都按那个类数按钮；
 * 3. 通道 = 只用本地时三档 `disabled`，**值保留**（`cloud.auto` 一个字节不清）。
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
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncCloudAutoProps {
  draft: MdSyncDraft;
}

const SCHEDULES: CloudSchedule[] = ['off', 'interval', 'smart'];
const LABELS: Record<CloudSchedule, string> = {
  off: AUTO_COPY.off,
  interval: AUTO_COPY.interval,
  smart: AUTO_COPY.smart,
};

export function MdSyncCloudAuto({ draft }: MdSyncCloudAutoProps) {
  const { cloud, saving, updateCloud } = draft;
  const auto = autoOf(cloud.auto);
  /* 绑的是 `cloud.enabled`（存储通道），与卡片里其余输入框同一个判据。 */
  const disabled = !cloud.enabled || saving;
  const [minutesText, setMinutesText] = useState<string | null>(null);

  /** 只有用户真的动过控件才写 `auto`；渲染时绝不 patch（老配置逐字节不变）。 */
  const patch = (next: Partial<MdCloudAutoValue>) => {
    updateCloud({ ...cloud, auto: { ...auto, ...next } });
  };
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
        {SCHEDULES.map((value) => (
          <button
            key={value}
            type="button"
            className="sync-cloud__auto-item"
            data-tier={value}
            aria-pressed={auto.schedule === value}
            disabled={disabled}
            onClick={() => choose(value)}
          >
            {LABELS[value]}
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
              aria-label="云端自动同步间隔（分钟）"
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
