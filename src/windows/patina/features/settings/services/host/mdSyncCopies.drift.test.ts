/**
 * 「同一份逻辑两份副本」的**漂移哨兵**（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 背景：设置页搬进分析窗时，`mdSyncAuto` / `mdSyncCopy` / `mdSyncConfig` 被复制成两份 ——
 *
 *   · `src/features/settings/services/host/*`   ← 桌面（分析窗）实际运行的那份
 *   · `src/components/settings/*`               ← 手机端 `SyncPane` / `SyncCloudPane` 还在用
 *
 * 为什么不能只留一份：L9 双窗隔离禁止分析窗 import 主窗模块（反过来也一样），而手机端是
 * 主窗入口。为什么不能各写一套用例：逻辑逐字相同，写两套只会让「改一处忘了另一处」变成
 * 两个都能过的绿灯 —— 那正是这次要防的东西。
 *
 * 所以做法是**漂移哨兵**：把两份文件去掉注释与 import 之后逐行比。等价就说明「只改了
 * 搬运方式，没改逻辑」；不等价就红，逼人要么同步两份、要么在注释里写明差异点。
 *
 * 已知且**允许**的差异只有 import 路径本身（`./hostTypes` vs `../../types/domain`），
 * 所以 `normalize` 会把整段 import（含跨行的 `import type {\n…\n} from '…';`）一起删掉。
 */
import { describe, expect, it } from 'vitest';
import { code, PROJECT_ROOT } from '../../settingsSourceProbe.test-utils';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { resolve } from 'node:path';

/** 去注释 → 去 import → 去空行与行尾空白。剩下的就是「逻辑正文」。 */
function normalize(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const withoutImports = withoutComments
    .replace(/^\s*import[\s\S]*?["'][^"']*["'];?[ \t]*$/gm, '')
    .replace(/^\s*import\s+["'][^"']+["'];?$/gm, '');
  return withoutImports
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

/** 两份副本的路径（桌面对手机）。 */
const PAIRS: readonly { name: string; desktop: string; mobile: string }[] = [
  {
    name: 'mdSyncAuto.ts',
    desktop: 'src/windows/patina/features/settings/services/host/mdSyncAuto.ts',
    mobile: 'src/windows/timing/components/settings/mdSyncAuto.ts',
  },
  {
    name: 'mdSyncCopy.ts',
    desktop: 'src/windows/patina/features/settings/services/host/mdSyncCopy.ts',
    mobile: 'src/windows/timing/components/settings/mdSyncCopy.ts',
  },
  {
    name: 'mdSyncConfig.ts',
    desktop: 'src/windows/patina/features/settings/services/host/mdSyncConfig.ts',
    mobile: 'src/windows/timing/components/settings/mdSyncConfig.ts',
  },
];

/** 读原文（**不去注释**——`normalize` 自己要去掉注释，两步不能叠）。 */
function readRaw(rel: string): string {
  return readFileSync(resolve(PROJECT_ROOT, rel), 'utf8');
}

describe('md 同步的「两份副本」必须逐字同源', () => {
  it('mobile copy still exists (哨兵的哨兵：副本被删了，这个文件就不该再绿)', () => {
    /* 如果哪天手机端也搬到分析窗、这 4 份副本被删掉，那么「漂移」就无从谈起：
       届时应当**删掉本文件**并让 `mdSyncConfig.test.ts` / `mdSyncShared.test.ts`
       成为唯一覆盖，而不是让这里的断言空转。 */
    for (const pair of PAIRS) {
      const mobile = readRaw(pair.mobile);
      expect(mobile.trim().length, `${pair.mobile} 空了或已被删除`).toBeGreaterThan(0);
      expect(
        code(pair.mobile).includes('export'),
        `${pair.mobile} 里没有 export —— 副本可能被清空了`,
      ).toBe(true);
    }
  });

  for (const pair of PAIRS) {
    it(`${pair.name}: desktop 与 mobile 的逻辑正文逐字相同（改一处必须两处同改）`, () => {
      const desktop = normalize(readRaw(pair.desktop));
      const mobile = normalize(readRaw(pair.mobile));
      expect(desktop.length, `${pair.desktop} 正文为空，检查 normalize 是否吃掉了整个文件`)
        .toBeGreaterThan(200);
      /* 断言用「首个差异行的上下文」而不是整份正文：红的时候要能一眼看出差在哪，
         而不是被 100 行 diff 淹掉。 */
      if (desktop !== mobile) {
        const d = desktop.split('\n');
        const m = mobile.split('\n');
        const at = d.findIndex((line, index) => line !== m[index]);
        expect(
          { line: at + 1, desktop: d[at], mobile: m[at] },
          `${pair.name} 漂移了：桌面副本与手机副本在这一行分叉（改一处必须两处同改）`,
        ).toEqual({ line: -1, desktop: undefined, mobile: undefined });
      }
      expect(desktop).toBe(mobile);
    });
  }
});
