/**
 * entry 接线测试（施工单 §8 M-6 / M-7；V-5 / V-5b 的靶子）
 * -----------------------------------------------------------------------------
 * M-6 是**位置契约**（辅助判据）：两个 entry 的第 1 条 import 指向
 * `activityStorageBootstrap`，**且该文件里有模块级 `ensureMigrated()` 调用**——
 * 后半句不能省：纯导出模块会被 import 求值但什么都不做，只看 import 行
 * 就会被 ESM hoist 那个坑满足。
 *
 * M-7 是**行为级**（主判据是它 + M-13）：预置老键 ⇒ **真的 import 那个 entry 模块**
 * ⇒ 断言迁移已发生。不许用"手工先 import 迁移模块再 import boardStore"代替——
 * 那验的是测试自己写的顺序（代理的代理）。
 *
 * G-4 的机械证明在这里：两处 entry 各一条 M-7；V-5b 会分别只删一处，两次都必须红。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT } from '../activity/features/dashboard/layout/defaultLayout';

const sharedDir = dirname(fileURLToPath(import.meta.url));
const ACTIVITY_ENTRY = join(sharedDir, '..', 'activity', 'shell', 'main.tsx');
const TIMING_ENTRY = join(sharedDir, '..', 'timing', 'entry', 'main.tsx');
const BOOTSTRAP = join(sharedDir, 'activityStorageBootstrap.ts');

/* entry 的模块级语句会走 Tauri 网关；jsdom 里没有 Tauri runtime，把传输层换成
   "永远成功返回 null"的桩。被测对象是 entry 的 import 顺序与模块级副作用，
   传输层不在被测面里——这不是降级（M-7 仍然真的 import entry）。 */
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invoke: vi.fn(async () => null),
}));
vi.mock('@tauri-apps/api/event', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
}));

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('M-6 · 位置契约（第 1 条 import + 模块级副作用）', () => {
  /** 判"工作树"（readFileSync），不判 HEAD —— R14。 */
  function firstImportLine(path: string): string {
    const source = readFileSync(path, 'utf8');
    const match = source.match(/^import\b.*$/m);
    if (!match) throw new Error(`${path} 里一条 import 都没有`);
    return match[0];
  }

  it('activity entry 的第 1 条 import 指向 activityStorageBootstrap', () => {
    expect(firstImportLine(ACTIVITY_ENTRY)).toContain('activityStorageBootstrap');
  });

  it('timing entry 的第 1 条 import 指向 activityStorageBootstrap', () => {
    expect(firstImportLine(TIMING_ENTRY)).toContain('activityStorageBootstrap');
  });

  it('bootstrap 文件里有模块级 ensureMigrated() 调用（纯导出模块的 import 是零副作用）', () => {
    const source = readFileSync(BOOTSTRAP, 'utf8');
    expect(source, '缺 import').toContain("from './activityStorageKeys'");
    expect(source, '缺模块级调用：只 import 不调用 = 迁移一次都不跑').toMatch(/^ensureMigrated\(\);/m);
  });
});

describe('M-7 · 行为级：真 entry import ⇒ 老键已迁移（两处 entry 各一条，G-4）', () => {
  it('activity entry：预置 v3 老布局 ⇒ import 后 boardStore 初始 layout == 旧布局', async () => {
    const oldLayout = {
      ...DEFAULT_LAYOUT,
      cards: [{ ...DEFAULT_LAYOUT.cards[0], x: 40 }],
    };
    window.localStorage.setItem('patina:dashboard-layout:v3', JSON.stringify(oldLayout));

    vi.resetModules();
    await import('../activity/shell/main.tsx');
    const { useBoardStore } = await import('../activity/features/dashboard/layout/boardStore.ts');

    /* boardStore 的模块求值（`layout: loadLayout().layout`）读的是迁移后的新键。 */
    expect(useBoardStore.getState().layout.cards[0].x).toBe(40);
    expect(window.localStorage.getItem('activity:dashboard-layout:v3')).not.toBeNull();
    expect(window.localStorage.getItem('patina:dashboard-layout:v3')).not.toBeNull();
  });

  it('timing entry：预置老键 ⇒ import 后新键已就位（profile A 的 timing 窗也被覆盖）', async () => {
    window.localStorage.setItem('patina:export-format', 'sqlite');

    vi.resetModules();
    await import('../timing/entry/main.tsx');

    expect(window.localStorage.getItem('activity:export-format')).toBe('sqlite');
    expect(window.localStorage.getItem('patina:export-format')).toBe('sqlite');
  });
});
