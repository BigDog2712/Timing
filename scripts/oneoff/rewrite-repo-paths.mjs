#!/usr/bin/env node
/* 一次性：把配置/门禁/基线里指向 src/ 的仓库相对路径，按双窗重排后的前缀改写。
 *
 * 只改「字符串里的 src/xxx」这类仓库相对路径；相对 import 已由 migrate-src-layout.mjs 重算。
 * 边界保护：`src-tauri/src/app/...` 里也含 `src/app/`，绝不能误改 —— 用 (?<![\w-]) 断言。
 *
 * 用法：node scripts/oneoff/rewrite-repo-paths.mjs [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const MAP = [
  // 入口单文件（HTML 里是 /src/main.tsx 这种带前导斜杠的写法，需要单独一条）
  ['src/main.tsx', 'src/windows/timing/entry/main.tsx'],
  ['src/App.tsx', 'src/windows/timing/entry/App.tsx'],
  ['src/app/', 'src/windows/patina/shell/'],
  ['src/features/', 'src/windows/patina/features/'],
  ['src/platform/', 'src/windows/patina/platform/'],
  ['src/shared/', 'src/windows/patina/shared/'],
  ['src/components/', 'src/windows/timing/components/'],
  ['src/hooks/', 'src/windows/timing/hooks/'],
  ['src/services/', 'src/windows/timing/services/'],
  ['src/stores/', 'src/windows/timing/stores/'],
  ['src/styles/', 'src/windows/timing/styles/'],
  ['src/types/', 'src/windows/timing/types/'],
  ['src/lib/', 'src/windows/timing/lib/'],
  ['src/mocks/', 'src/windows/timing/mocks/'],
];

const FILES = [
  'index.html',
  'patina.html',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  'scripts/check-layers.mjs',
  'scripts/check-contract.mjs',
  'scripts/check-size.mjs',
  'scripts/check-vendored-diff.mjs',
  'scripts/brand-gate.mjs',
  'scripts/android-apk.mjs',
  'scripts/android-log.mjs',
  'scripts/size-allowlist.json',
  'scripts/vendored-allowlist.json',
  'scripts/vendored-baseline.json',
  'scripts/brand-allowlist.txt',
];

let total = 0;
const report = [];
for (const rel of FILES) {
  let text;
  try {
    text = readFileSync(rel, 'utf8');
  } catch {
    continue;
  }
  const before = text;
  let n = 0;
  for (const [from, to] of MAP) {
    const re = new RegExp(`(?<![\\w-])${from.replace(/[/.]/g, '\\$&')}`, 'g');
    text = text.replace(re, () => {
      n += 1;
      return to;
    });
  }
  if (text !== before) {
    total += n;
    report.push(`${rel}: ${n} 处`);
    if (APPLY) writeFileSync(rel, text, 'utf8');
  }
}
console.log(report.join('\n') || '（无变化）');
console.log(`[路径改写] 合计 ${total} 处${APPLY ? '，已写入' : '（干跑）'}`);
