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
  exportOne: vi.fn(),
}));

vi.mock('../../services/mobileNative', () => ({
  mobileNative: {
    backupList: mocks.list,
    backupRestore: mocks.restore,
    backupExport: mocks.exportOne,
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
  mocks.exportOne.mockReset();
  mocks.list.mockResolvedValue([WEBDAV, OBSIDIAN]);
  mocks.restore.mockResolvedValue({
    date: '2026-11-06',
    target: 'webdav',
    imported: 12,
    written: 1,
  });
  mocks.exportOne.mockResolvedValue({
    saved: true,
    name: '2026-11-06-20261108-120000.md',
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

  /** 手机上只认云端那份：`obsidian__` 的备份不给「恢复」按钮，只留一句说明。
   *  [V0.11.23] 但「导出」要给——导出是副本，不需要落点。 */
  it('p6_obsidian_backup_has_no_restore_button', async () => {
    await mount();
    const row = host.querySelector('[data-backup-name="obsidian__2026-11-05-20261107-120000.md"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('[data-backup-action="restore"]')).toBeNull();
    expect(row?.querySelector('[data-backup-action="export"]')).not.toBeNull();
    expect(row?.textContent).toContain('手机上恢复不了');
  });

  /** 空列表也要说话：一句「还没有备份」比一片空白更让人安心。 */
  it('p6_empty_list_says_so', async () => {
    mocks.list.mockResolvedValue([]);
    await mount();
    expect(text()).toContain('还没有备份');
  });

  /* ---------------- [V0.11.23] 导出（PRD P1 / P3 / P4 / P5） ---------------- */

  /** P1：每一条都有「导出」——包括手机上恢复不了的那条（导出是副本，不需要落点）。 */
  it('p1_every_backup_can_be_exported', async () => {
    await mount();
    expect(host.querySelectorAll('[data-backup-action="export"]')).toHaveLength(2);
  });

  /** P3：点一次只发一条命令，参数就是这一条的名字；导出不许顺手动恢复。 */
  it('p3_export_sends_one_command', async () => {
    await mount();
    await act(async () => {
      $('[data-backup-action="export"]').click();
    });
    expect(mocks.exportOne).toHaveBeenCalledTimes(1);
    expect(mocks.exportOne).toHaveBeenCalledWith(WEBDAV.name);
    expect(text()).toContain('已保存 2026-11-06-20261108-120000.md');
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  /** P4：用户在选择器里按返回 → 只有一句「已取消」，**不许出现红字**。 */
  it('p4_cancel_is_not_an_error', async () => {
    mocks.exportOne.mockResolvedValue({ saved: false, name: '2026-11-06-20261108-120000.md' });
    await mount();
    await act(async () => {
      $('[data-backup-action="export"]').click();
    });
    expect(text()).toContain('已取消，没有写入任何文件');
    expect(host.querySelector('.m-backup__error')).toBeNull();
  });

  /** 真失败才给红字，而且是原文（「备份已不在」与「写不进去」是两句不同的行动指令）。 */
  it('p3_export_failure_shows_raw_text', async () => {
    mocks.exportOne.mockRejectedValue(
      new Error('这份备份已经不在了（备份只保留最近 30 份）：webdav__x.md'),
    );
    await mount();
    await act(async () => {
      $('[data-backup-action="export"]').click();
    });
    const err = host.querySelector('.m-backup__error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('只保留最近 30 份');
  });

  /** P5：导出只读——不刷新列表（刷新会让人以为「多了一份备份」）。 */
  it('p5_export_does_not_reload_list', async () => {
    await mount();
    const before = mocks.list.mock.calls.length;
    await act(async () => {
      $('[data-backup-action="export"]').click();
    });
    expect(mocks.list.mock.calls.length).toBe(before);
  });
});
