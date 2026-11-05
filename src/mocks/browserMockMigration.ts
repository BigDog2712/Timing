/**
 * TickBar — 浏览器降级 Mock：迁移可见性两条命令（V0.5.0）
 * -----------------------------------------------------------------------------
 * 纯浏览器（`npm run dev` / 单测）没有 Tauri 运行时，`get_migration_info` 无从
 * 读真实标记文件，这里给一份**诚实的**退化答案：`fresh`（目标无库、老目录无数据）。
 * 不用假的「已迁移」糊弄——浏览器 dev 下展示一条假迁移记录，会让 UI 走查得出
 * 错误结论（以为卡片在真机上就长这样）。
 *
 * ⚠️ 键必须 **4 空格缩进**：`scripts/check-contract.mjs:155` 的正则
 * `^ {4}([a-z][a-z0-9_]*):\s*\(` 只认这个形态，缩进改了 mock 数就少一条，
 * `npm run check:contract` 直接红。
 */
import type { MigrationInfo } from '../types/domain';
import { fail } from './mockSeed';

export function createMockApiMigration(): Record<string, (args?: any) => unknown> {
  const info: MigrationInfo = {
    source: 'fresh',
    migratedAt: null,
    appVersionAtMigration: null,
    legacyDir: null,
    legacyExists: false,
    dbBytes: null,
    rowCounts: null,
  };
  return {
    get_migration_info: () => ({ ...info }),
    /* 浏览器里没有资源管理器可跳：与后端「目录不存在 → IO_ERROR」同口径，静默成功更糟 */
    open_legacy_dir: () => fail('IO_ERROR', '浏览器预览模式没有旧数据目录'),
  };
}
