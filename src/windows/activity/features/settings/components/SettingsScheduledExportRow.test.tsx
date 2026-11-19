/**
 * `SettingsScheduledExportRow`（「定时导出」这一行）—— [B5d] 从导出弹窗提出来的入口
 * -----------------------------------------------------------------------------
 * 这一行搬的是**入口**，不是表单。它守四件事：
 *   ① 入口在设置页里（数据导出组内、`SettingsFullBundleExportRow` 之前），不在导出弹窗里；
 *   ② 懒加载：不点不加载 —— 弹窗组件与快照都不该进首屏；
 *   ③ 默认格式/字段集取自**已保存的导出偏好**（`readExportFormat` / `readExportFields`），
 *      不是某个弹窗里还没确认的临时选择。这条最容易在重构里悄悄退化成硬编码 `'csv'`，
 *      所以下面有一条专钉它；
 *   ④ 单一入口：`SettingsDataExportDialog.tsx` 里不能再长回 `CalendarClock` /
 *      `scheduledExportOpen`（那就是被拆掉的"四级深度"的原样）。
 *
 * 变异自证（真做过，见 B5d 报告）：
 *   · 把 `readExportFormat()` 换成硬编码 `'csv'` → n03 红（`markdown` ≠ `csv`）；
 *   · 把懒加载改成静态 `import` → n07 红；
 *   · 在导出弹窗里加回 `CalendarClock` → n08 红。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prefs = vi.hoisted(() => ({
  readExportFormat: vi.fn(),
  readExportFields: vi.fn(),
}));

const dialogApi = vi.hoisted(() => ({
  loadScheduledExportSnapshot: vi.fn(),
}));

vi.mock('../services/settingsDataExportPreferences.ts', () => ({ ...prefs }));

/* 弹窗本体在 `SettingsDataExportDialog` 里是很重的一块；这一份只管**入口**，
   所以把弹窗替换成一个把入参摊到 `data-*` 上的探针 —— 断言"传进去了什么"，
   不去断言弹窗内部长什么样（那是它自己的用例的事）。 */
vi.mock('./SettingsScheduledExportDialog.tsx', () => ({
  loadScheduledExportSnapshot: dialogApi.loadScheduledExportSnapshot,
  default: (props: {
    open: boolean;
    currentFormat: string;
    currentFields: readonly string[];
    onClose: () => void;
  }) => createElement('div', {
    'data-testid': 'scheduled-dialog',
    'data-open': String(props.open),
    'data-format': props.currentFormat,
    'data-fields': props.currentFields.join(','),
  }),
}));

import { LocaleProvider } from '../../../shared/i18n/index.ts';
import SettingsScheduledExportRow from './SettingsScheduledExportRow';
import { SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT } from '../services/settingsDataExportFields.ts';
import { code, importersOf } from '../settingsSourceProbe.test-utils';

const SNAPSHOT = { config: { enabled: true, format: 'markdown' }, nextExecutionAtMs: null };
/** 存下来的导出偏好：格式是 markdown，与默认的 csv 故意不同，才好区分"读到偏好"和"写死默认值" */
const SAVED_FORMAT = 'markdown';
const SAVED_FIELDS = ['app_name', 'start_time'];

let container: HTMLDivElement;
let root: Root;

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(element = createElement(SettingsScheduledExportRow)): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { locale: 'zh-CN', children: element }));
  });
  await flush(1);
}

function rowButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('.settings-preference-control button');
  if (!el) throw new Error('找不到「定时导出」这一行的按钮');
  return el;
}

function dialogProbe(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="scheduled-dialog"]');
}

async function clickRowButton(): Promise<void> {
  await act(async () => {
    rowButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  prefs.readExportFormat.mockReturnValue(SAVED_FORMAT);
  prefs.readExportFields.mockReturnValue([...SAVED_FIELDS]);
  dialogApi.loadScheduledExportSnapshot.mockResolvedValue(SNAPSHOT);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

describe('行形状与懒加载', () => {
  it('n01_renders_one_preference_row_and_does_not_load_anything_before_click', async () => {
    await mount();
    const row = container.querySelector('.settings-preference-row');
    expect(row).toBeTruthy();
    /* 行标题 = 弹窗标题（`UI_TEXT.export.scheduledTitle`），逐字一致 */
    expect(row?.querySelector('.settings-preference-title')?.textContent).toBe('定时导出');
    expect(rowButton().textContent).toBe('配置');

    /* 懒加载：不点就不该碰快照、也不该读偏好（都在 `handleOpen` 里） */
    expect(dialogApi.loadScheduledExportSnapshot).not.toHaveBeenCalled();
    expect(prefs.readExportFormat).not.toHaveBeenCalled();
    expect(dialogProbe()).toBeNull();
  });

  it('n02_click_loads_snapshot_once_and_mounts_the_dialog_open', async () => {
    await mount();
    await clickRowButton();

    expect(dialogApi.loadScheduledExportSnapshot).toHaveBeenCalledTimes(1);
    const probe = dialogProbe();
    expect(probe).toBeTruthy();
    expect(probe?.getAttribute('data-open')).toBe('true');
  });
});

describe('默认格式与字段集来自已保存的导出偏好', () => {
  it('n03_format_comes_from_read_export_format_not_a_hardcoded_default', async () => {
    await mount();
    await clickRowButton();

    expect(prefs.readExportFormat).toHaveBeenCalledTimes(1);
    expect(dialogProbe()?.getAttribute('data-format')).toBe(SAVED_FORMAT);
  });

  it('n04_fields_are_read_for_that_format_with_the_shared_per_format_default', async () => {
    await mount();
    await clickRowButton();

    /* 第二个入参必须是该格式的默认字段集 —— 传 `undefined` 或写死 csv 那份都会让
       "恢复默认"在 markdown 下恢复成 csv 的字段。 */
    expect(prefs.readExportFields).toHaveBeenCalledWith(
      SAVED_FORMAT,
      SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[SAVED_FORMAT],
    );
    expect(dialogProbe()?.getAttribute('data-fields')).toBe(SAVED_FIELDS.join(','));
  });
});

describe('失败与禁用态', () => {
  it('n05_snapshot_failure_reports_inline_and_does_not_mount_the_dialog', async () => {
    dialogApi.loadScheduledExportSnapshot.mockRejectedValue(new Error('ipc down'));
    /* 组件自己会 `console.error` 记一笔（线上要留痕），用例里把它收掉，别让日志淹掉断言 */
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount();
    await clickRowButton();
    quiet.mockRestore();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('设置加载失败。');
    expect(dialogProbe()).toBeNull();
    /* 失败不锁这一行：按钮要回到可用状态，用户能重试 */
    expect(rowButton().disabled).toBe(false);
  });

  it('n06_disabled_row_does_not_open', async () => {
    await mount(createElement(SettingsScheduledExportRow, { disabled: true }));
    expect(rowButton().disabled).toBe(true);
    expect(dialogApi.loadScheduledExportSnapshot).not.toHaveBeenCalled();
  });
});

describe('源码判据（防长回四级深度）', () => {
  const DIALOG = code('src/windows/activity/features/settings/components/SettingsDataExportDialog.tsx');
  const GROUP = code('src/windows/activity/features/settings/components/SettingsDataExportGroup.tsx');
  const ROW = code('src/windows/activity/features/settings/components/SettingsScheduledExportRow.tsx');

  it('n07_row_lazy_loads_the_dialog_instead_of_importing_it_up_front', () => {
    expect(ROW).toContain('import("./SettingsScheduledExportDialog.tsx")');
    expect(ROW).not.toMatch(/from\s+["']\.\/SettingsScheduledExportDialog\.tsx["']/);
    /* 单一入口：整个视图层只有这一行提到定时导出弹窗（静态 import 或懒加载都算） */
    expect(importersOf('SettingsScheduledExportDialog.tsx')).toEqual([
      'src/windows/activity/features/settings/components/SettingsScheduledExportRow.tsx',
    ]);
  });

  it('n08_export_dialog_no_longer_carries_the_scheduled_export_entry', () => {
    expect(DIALOG).not.toContain('CalendarClock');
    expect(DIALOG).not.toContain('scheduledExportOpen');
    expect(DIALOG).not.toContain('SettingsScheduledExportDialog');
  });

  it('n09_row_sits_between_data_import_and_full_bundle_in_the_export_group', () => {
    const importAt = GROUP.indexOf('dataImportAction');
    const scheduledAt = GROUP.indexOf('<SettingsScheduledExportRow');
    const bundleAt = GROUP.indexOf('<SettingsFullBundleExportRow');
    expect(importAt).toBeGreaterThan(-1);
    expect(scheduledAt).toBeGreaterThan(-1);
    expect(bundleAt).toBeGreaterThan(-1);
    expect(importAt).toBeLessThan(scheduledAt);
    expect(scheduledAt).toBeLessThan(bundleAt);
  });
});
