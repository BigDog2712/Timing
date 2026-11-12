/**
 * md 同步纯函数的「唯一真源」哨兵（[0.12.1 共享层] 由原「两份副本不许漂移」改造）
 * -----------------------------------------------------------------------------
 * 背景：0.12.1 设置页搬进分析窗时，`mdSyncAuto` / `mdSyncCopy` / `mdSyncConfig` 被复制成两份
 * （分析窗一份、主窗/手机端一份），靠本文件逐行比「逻辑正文」防止漂移。
 * 那是**权宜之计**：副本永远在，漂移风险就永远在，只是被一条测试盯着 —— 改完一边忘了另一边，
 * 这次红、下次照样可能忘。
 *
 * 0.12.1 末建了 `src/windows/shared/`，三份逻辑合并为**一份**，两侧各留一条 `export *` 壳。
 * 于是本文件的判据从「两份逻辑一致」换成两条更硬的：
 *
 *   1. **壳里不许有逻辑**。壳一旦写入实现，等于「副本又长出来了」，只是换了写法 ——
 *      而这次连 diff 都不会提示（两份壳可以长得一模一样）。
 *   2. **两侧壳必须指向同一真源**，且真源必须在 `src/windows/shared/settings/` 下。
 *      指向不同文件等于分叉，且同样没有肉眼可见的症状。
 *
 * 为什么保留本文件而不是删掉：原测试自己写过「副本被删时应删掉本文件」，但那个假设是
 * 「只剩分析窗一份、手机端复用分析窗组件」。实际做的是**下沉到共享层** —— 两侧仍是两个
 * 入口各自 import，所以「两侧都接到同一份实现」依然是需要机器保证的事实。
 */
import { describe, expect, it } from 'vitest';
import { code, PROJECT_ROOT } from '../../settingsSourceProbe.test-utils';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { relative, resolve } from 'node:path';

const TIMING_DIR = 'src/windows/timing/components/settings';
const PATINA_DIR = 'src/windows/patina/features/settings/services/host';
const TRUE_SOURCE_DIR = 'src/windows/shared/settings';

/** 三份纯函数 × 两侧壳（主窗/手机端 vs 分析窗）。 */
const MODULES = ['mdSyncAuto', 'mdSyncCopy', 'mdSyncConfig'] as const;

const SHELLS = MODULES.flatMap((name) => [
  { name, side: '主窗/手机端', path: `${TIMING_DIR}/${name}.ts` },
  { name, side: '分析窗', path: `${PATINA_DIR}/${name}.ts` },
]);

/** 读壳里的 `export * from '…'`，解析成仓库相对路径（去扩展名）。 */
function targetOf(rel: string): string {
  const body = code(rel);
  const m = /export\s+\*\s+from\s+['"]([^'"]+)['"]/.exec(body);
  expect(m, `${rel} 不是 \`export *\` 转发壳`).not.toBeNull();
  const abs = resolve(PROJECT_ROOT, rel.replace(/[^/]+$/, ''), m![1]);
  return relative(PROJECT_ROOT, abs).split('\\').join('/').replace(/\.tsx?$/, '');
}

/** 去掉转发语句与空白后，壳里还剩什么（应当什么都不剩）。 */
function residual(rel: string): string {
  const raw = readFileSync(resolve(PROJECT_ROOT, rel), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/export\s+\*\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/\s+/g, '');
}

describe('md 同步纯函数只有一份真源（0.12.1 共享层）', () => {
  it('两侧壳指向的目标集合恰好是真源目录下的三份', () => {
    const targets = new Set(SHELLS.map((s) => targetOf(s.path)));
    expect(targets.size, '两侧壳指向了多个不同目标 —— 说明已经分叉').toBe(MODULES.length);
    for (const name of MODULES) {
      expect([...targets], `${name} 的真源不在 ${TRUE_SOURCE_DIR}/ 下`).toContain(
        `${TRUE_SOURCE_DIR}/${name}`,
      );
    }
  });

  for (const name of MODULES) {
    it(`${name}: 两侧壳指向同一真源`, () => {
      const mobile = targetOf(`${TIMING_DIR}/${name}.ts`);
      const desktop = targetOf(`${PATINA_DIR}/${name}.ts`);
      expect(desktop, `${name} 两侧壳指向不同文件（已分叉）`).toBe(mobile);
      expect(mobile).toBe(`${TRUE_SOURCE_DIR}/${name}`);
    });
  }

  for (const shell of SHELLS) {
    it(`${shell.name}（${shell.side}）: 壳里没有任何逻辑`, () => {
      expect(
        residual(shell.path),
        `${shell.path} 的转发壳里出现了实现代码 —— 副本又长出来了，改回 \`export *\` 或改真源`,
      ).toBe('');
    });
  }
});
