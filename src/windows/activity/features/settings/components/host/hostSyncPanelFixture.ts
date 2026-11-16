/**
 * `HostSyncPanel` 测试夹具（从 `HostSyncPanel.test.tsx` 拆出，腾行数）。
 *
 * `view()` 返回一份**字段严格齐备**的 `MdSyncViewCloud`：宿主 DTO 少一个字段就是
 * 渲染期崩，而崩在 `render()` 里时 vitest 只给「Cannot read properties of undefined」，
 * 看不出是夹具的问题。所以这份夹具只许加字段、不许删字段。
 */
import type { MdSyncViewCloud } from '../../services/host/hostTypes';

export const BINDING = (kind: 'timers' | 'notes' | 'todos') => ({
  kind, enabled: true, root: '%APP_DIR%\\md', file: '{today}.md', heading: 'Timing',
});

/** `md_sync_get` 的最小合法视图（字段严格照 `MdSyncViewCloud`，缺一个就是渲染期崩） */
export function view(): MdSyncViewCloud {
  return {
    today: '2026-11-11',
    config: {
      enabled: true,
      pollSecs: 180,
      bindings: [BINDING('timers'), BINDING('notes'), BINDING('todos')],
      cloud: null,
      cloudFolder: null,
      cloudWebdav: null,
      diaryTemplate: '',
    },
    status: {
      lastSyncAt: null,
      lastError: null,
      bindings: [
        { kind: 'timers', path: 'C:\\md\\2026-11-11.md', exists: true, lastError: null, lastSyncAt: null, lastDirection: null },
        { kind: 'notes', path: 'C:\\md\\notes\\2026-11-11.md', exists: true, lastError: null, lastSyncAt: null, lastDirection: null },
        { kind: 'todos', path: 'C:\\md\\todos\\2026-11-11.md', exists: true, lastError: null, lastSyncAt: null, lastDirection: null },
      ],
    },
    cloud: {
      enabled: false, mode: 'localfolder', hasSecret: false,
      todayPushed: false, pendingDates: [], lastError: null,
    },
  };
}

export const DATA_ROOT = {
  current: '<exe>\\data', defaultPath: '<exe>\\data', isDefault: true, writable: true,
  writableError: null, pending: null, previous: null, sizeBytes: 0,
  entries: [], affected: [], pluginsInDataRoot: false,
};
