/**
 * `MigrationInfoCard` —— 设置页「数据迁移」卡（V0.5.0）
 *
 * 这块卡是用户**唯一**能确认「我的数据从哪来」的地方（迁移发生在窗口出现前），
 * 所以三件事都必须对：
 *   1. 五种 `source` 各自有一句人话（`Record<MigrationSource, …>` 保证不遗漏）；
 *   2. 迁移成功时数字可核对（行数 / 字节数 / 时间 / 版本）；
 *   3. 「打开旧数据目录」只在旧目录确实存在时出现，失败原因要显示出来
 *      （目录被用户删掉是最常见的失败，静默无反应比报错更糟）。
 *
 * 渲染走真实 DOM（`createRoot` + `act`），与 `GeneralTab.test.tsx` 同一套手法。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcError, ipc } from '../../services/ipc';
import type { MigrationInfo } from '../../types/domain';
import { MigrationInfoCard } from './MigrationInfoCard';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** 一份「已迁移」的完整信息：所有可空字段都有值，用来检验展示分支 */
const MIGRATED: MigrationInfo = {
  source: 'legacy',
  migratedAt: '2026-11-04T15:20:31+08:00',
  appVersionAtMigration: '0.5.0',
  legacyDir: 'C:\\Users\\me\\AppData\\Roaming\\com.tickbar.app',
  legacyExists: true,
  dbBytes: 81920,
  rowCounts: { items: 8, timeRecords: 512, todos: 20, notes: 3, settings: 14 },
};

async function mount(info: MigrationInfo): Promise<HTMLDivElement> {
  vi.spyOn(ipc, 'getMigrationInfo').mockResolvedValue(info);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MigrationInfoCard));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  vi.restoreAllMocks();
});

describe('MigrationInfoCard —— 来源文案', () => {
  it('legacy：说清已迁移 + 时间（只切分不换算）+ 行数 + 字节数 + 版本', async () => {
    const el = await mount(MIGRATED);

    expect(el.querySelector('.card__title')?.textContent).toBe('数据迁移');
    expect(el.textContent).toContain('已从 TickBar 迁移');
    /* ISO8601 直接切分成「日期 时分」——经 Date 会按运行环境时区再换算一次 */
    expect(el.textContent).toContain('2026-11-04 15:20');
    expect(el.textContent).toContain('事项 8');
    expect(el.textContent).toContain('记录 512');
    expect(el.textContent).toContain('80.0 KB');
    expect(el.textContent).toContain('迁移时版本 v0.5.0');
    expect(el.textContent).toContain('旧数据目录会原样保留');
  });

  it('pending：提示「上次选了空白启动」，并给出旧目录路径', async () => {
    const el = await mount({
      source: 'pending',
      migratedAt: null,
      appVersionAtMigration: null,
      legacyDir: MIGRATED.legacyDir,
      legacyExists: true,
      dbBytes: null,
      rowCounts: null,
    });

    expect(el.textContent).toContain('旧数据待迁移');
    expect(el.textContent).toContain('空白数据启动');
    expect(el.querySelector('.mig__path')?.textContent).toBe(MIGRATED.legacyDir);
  });

  it('fresh / skipped / unattached 各有独立文案（不是同一句兜底）', async () => {
    const fresh = await mount({ ...MIGRATED, source: 'fresh', legacyDir: null, legacyExists: false, migratedAt: null, appVersionAtMigration: null, dbBytes: null, rowCounts: null });
    expect(fresh.textContent).toContain('全新数据');
    await act(async () => root.unmount());
    fresh.remove();

    const skipped = await mount({ ...MIGRATED, source: 'skipped', legacyExists: false });
    expect(skipped.textContent).toContain('已跳过迁移（开发模式）');
    await act(async () => root.unmount());
    skipped.remove();

    const unattached = await mount({ ...MIGRATED, source: 'unattached', migratedAt: null, rowCounts: null, dbBytes: null, appVersionAtMigration: null });
    expect(unattached.textContent).toContain('发现未采用的旧数据');
  });
});

describe('MigrationInfoCard —— 打开旧数据目录', () => {
  it('目录存在时才出现按钮；点击调 migrationActions（无入参）', async () => {
    const open = vi.spyOn(ipc, 'openLegacyDir').mockResolvedValue(undefined);
    const el = await mount(MIGRATED);

    const button = el.querySelector<HTMLButtonElement>('.mig__btn');
    expect(button?.textContent).toBe('打开旧数据目录');

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith();
  });

  it('目录已不存在：不渲染按钮（点了必然失败，不如不给）', async () => {
    const el = await mount({ ...MIGRATED, legacyExists: false });

    expect(el.querySelector('.mig__btn')).toBeNull();
  });

  it('打开失败（目录被删）把原因显示出来，不静默', async () => {
    vi.spyOn(ipc, 'openLegacyDir').mockRejectedValue(new IpcError('IO_ERROR', '旧数据目录不存在'));
    const el = await mount(MIGRATED);

    await act(async () => {
      el.querySelector<HTMLButtonElement>('.mig__btn')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.querySelector('.inline-error')?.textContent).toBe('系统调用失败，请重试');
  });
});

describe('MigrationInfoCard —— 首帧与失败', () => {
  it('既没有信息也没有错误时不渲染任何东西（不占位、不闪）', async () => {
    vi.spyOn(ipc, 'getMigrationInfo').mockImplementation(() => new Promise(() => undefined));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MigrationInfoCard));
    });

    expect(container.textContent).toBe('');
  });

  it('查询失败：显示兜底文案，卡片仍可见（错误本身也是一种信息）', async () => {
    vi.spyOn(ipc, 'getMigrationInfo').mockRejectedValue(new IpcError('IO_ERROR', '读不到'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MigrationInfoCard));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('.inline-error')?.textContent).toBe('系统调用失败，请重试');
  });
});
