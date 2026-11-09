/**
 * Timing — 三档纯函数的判据（V0.11.19 批 1；[V0.11.26] 从 `mdSyncAuto.test.tsx` 拆出）
 * -----------------------------------------------------------------------------
 * 拆分理由只有一个：`check:size` 是 300 行硬门禁（零豁免），而 DOM 那半（真 `MdSyncTab`
 * 走双通路）自己就占满了。纯函数不碰 DOM、不需要 mock，分开放反而更好读。
 *
 * 覆盖：`defaultAuto / autoOf` 的收敛、`clampAutoMinutes` 的夹值、`withSchedule` 的 H-2
 * 口径、`purgeNoteOf` 的优先级与逐字、`AUTO_COPY` 文案表。
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_MINUTES,
  AUTO_MIN_MINUTES,
  autoOf,
  clampAutoMinutes,
  defaultAuto,
  purgeNoteOf,
  withSchedule,
} from './mdSyncAuto';
import { AUTO_COPY, PURGE_COPY, REMOVED_PHRASES } from './mdSyncCopy';

describe('mdSyncAuto —— 纯函数', () => {
  it('老配置缺 auto → 智能 + 15；坏值收敛，不写回', () => {
    expect(defaultAuto()).toEqual({ schedule: 'smart', intervalMinutes: 15 });
    expect(autoOf(undefined)).toEqual(defaultAuto());
    expect(autoOf(null)).toEqual(defaultAuto());
    expect(autoOf({ schedule: 'off', intervalMinutes: 999 }))
      .toEqual({ schedule: 'off', intervalMinutes: AUTO_MAX_MINUTES });
  });

  it('D2：1 → 5，999 → 120，非数字回 15', () => {
    expect(clampAutoMinutes('1')).toBe(AUTO_MIN_MINUTES);
    expect(clampAutoMinutes('999')).toBe(AUTO_MAX_MINUTES);
    expect(clampAutoMinutes('')).toBe(15);
    expect(clampAutoMinutes('abc')).toBe(15);
    expect(clampAutoMinutes('30')).toBe(30);
  });

  it('H-2：切档只改 schedule，分钟数原样带过', () => {
    const auto = { schedule: 'interval' as const, intervalMinutes: 30 };
    expect(withSchedule(auto, 'smart')).toEqual({ schedule: 'smart', intervalMinutes: 30 });
    expect(auto.intervalMinutes).toBe(30);
  });

  it('四句清理文案的优先级与逐字（T04 接状态前先钉住选择器）', () => {
    expect(purgeNoteOf(undefined)).toBe(PURGE_COPY.idle);
    expect(purgeNoteOf({ paused: true, deleted: 9, failed: 4 }))
      .toBe('往期清理已暂停：4 份没能删掉。点「立即同步」重试。');
    expect(purgeNoteOf({ paused: false, deleted: 0, failed: 3 }))
      .toBe('云端只保留今天的日记；有 3 份往期没能删掉，下一轮再试。');
    expect(purgeNoteOf({ paused: false, deleted: 2, failed: 0 }))
      .toBe('云端只保留今天的日记；上次清理删了 2 份。');
    expect(purgeNoteOf({ paused: false, deleted: 0, failed: 0 })).toBe(PURGE_COPY.idle);
  });

  it('三档文案逐字表（§11.1；[V0.11.33] 第二档「定时」→「自动」+ smartNote 换稿，W5/W6）', () => {
    expect(AUTO_COPY).toEqual({
      label: '自动同步', off: '关闭', interval: '自动', smart: '智能',
      every: '每', minutes: '分钟', range: '5 ~ 120 分钟',
      smartNote: '启动后 1 分钟同步一次；停手 5 分钟同步一次；一直写则每 30 分钟同步一次。',
    });
    expect(REMOVED_PHRASES).toContain('同步间隔');
    expect(REMOVED_PHRASES).toContain('1 分钟 ~ 24 小时');
    /* [V0.11.33] 旧档位标签与旧 smartNote 进零命中清单（P6 / P7） */
    expect(REMOVED_PHRASES).toContain('定时');
    expect(REMOVED_PHRASES).toContain('停手 5 分钟后同步；启动时一次。');
  });
});

