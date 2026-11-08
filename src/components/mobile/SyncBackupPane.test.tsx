/**
 * Timing — 手机端「备份与恢复」的判据（V0.11.22，PRD P6）
 * -----------------------------------------------------------------------------
 * 恢复是**覆盖写**（文件 + SQL 一起回到留底那一刻），所以这一块只有一个必须钉住的行为：
 * **两步**。第一次点「恢复」不许发命令，只展开确认条；第二次点「确认恢复」才动手。
 * 一步到位的话，列表里一排「恢复」按钮就是一排误触即覆盖的开关。
 *
 * 另一条：手机上只认云端那份（`webdav__`）。`obsidian__` 的备份不给按钮——
 * 点了必然失败的东西不该摆在界面上（真正的拒绝仍在后端，这里只是不摆假希望）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem } from '../../types/domain';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../../services/mobileNative', () => ({
  mobileNative: {
    backupList: mocks.list,
    backupRestore: mocks.restore,
  },
}));

const { SyncBackupPane } = await import('./SyncBackupPane');

const WEBDAV: MdBackupItem = {
  name: 'webdav__2026-11-06-20261108-120000.md',
  target: 'webdav',
  source: '2026-11-06.md',
  date: '2026-11-06',
  atMs: Date.UTC(2026, 10, 8, 4, 0, 0),
  bytes: 2048,
};

const OBSIDIAN: MdBackupItem = {
  name: 'obsidian__2026-11-05-20261107-120000.md',
  target: 'obsidian',
  source: '2026-11-05.md',
  date: '2026-11-05',
  atMs: Date.UTC(2026, 10, 7, 4, 0, 0),
  bytes: 1024,
};

let host: HTMLDivElement;
let root: Root;

function $(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}

const text = () => host.textContent ?? '';

async function mount() {
  await act(async () => {
    root.render(createElement(SyncBackupPane));
  });
}

function click(selector: string) {
  act(() => {
    $(selector).click();
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mocks.list.mockReset();
  mocks.restore.mockReset();
  mocks.list.mockResolvedValue([WEBDAV, OBSIDIAN]);
  mocks.restore.mockResolvedValue({
    date: '2026-11-06',
    target: 'webdav',
    imported: 12,
    written: 1,
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('手机端备份与恢复', () => {
  /** P6：第一次点「恢复」只出确认条，命令一次都不发。 */
  it('p6_first_tap_only_asks', async () => {
    await mount();
    click('[data-backup-name="webdav__2026-11-06-20261108-120000.md"] .m-btn--small');
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(text()).toContain('会用这份备份覆盖当前内容');
  });

  /** P6：第二次点「确认恢复」才发命令，且只发一次。 */
  it('p6_second_tap_restores_once', async () => {
    await mount();
    click('[data-backup-name="webdav__2026-11-06-20261108-120000.md"] .m-btn--small');
    await act(async () => {
      $('.m-backup__confirm .m-btn--primary').click();
    });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledWith(WEBDAV.name);
    expect(text()).toContain('导入 12 条记录');
  });

  /** 取消：确认条收回，命令仍然一次都没发。 */
  it('p6_cancel_sends_nothing', async () => {
    await mount();
    const row = '[data-backup-name="webdav__2026-11-06-20261108-120000.md"]';
    click(`${row} .m-btn--small`);
    click('.m-backup__confirm .m-btn--small:last-child');
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(text()).not.toContain('会用这份备份覆盖当前内容');
  });

  /** 手机上只认云端那份：`obsidian__` 的备份不给「恢复」按钮，只留一句说明。 */
  it('p6_obsidian_backup_has_no_restore_button', async () => {
    await mount();
    const row = host.querySelector('[data-backup-name="obsidian__2026-11-05-20261107-120000.md"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.textContent).toContain('手机上恢复不了');
  });

  /** 空列表也要说话：一句「还没有备份」比一片空白更让人安心。 */
  it('p6_empty_list_says_so', async () => {
    mocks.list.mockResolvedValue([]);
    await mount();
    expect(text()).toContain('还没有备份');
  });
});
