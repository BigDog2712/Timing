#!/usr/bin/env node
/**
 * TickBar — 分层门禁（把架构规则变成 grep，而不是 code review 的口头约定）
 * -----------------------------------------------------------------------------
 * 规则来自 `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` §3.4（R1~R6/R10）：
 *
 *   L1 组件不得触碰传输层：`ipc.` / `invoke(` 在 src/components 下 0 命中
 *   L2 状态容器不得触碰传输层：同上，src/stores 下 0 命中
 *   L3 窗口 API 只能经 `src/lib/window.ts`：全仓只有它 import `@tauri-apps/api/window`
 *   L4 Rust `infra` 不得依赖 `services`（解环，见 ADR-016）
 *   L5 Rust `commands` 不得直接依赖 `repositories`（必须经 service）
 *   L6 Rust 全域不得出现 `eprintln!`（结构化日志，见 platform/log.rs）
 *
 * 每一条都是「改坏了 CI 就红」的判据，而不是「建议」。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'target', 'dist', 'gen']);

function walk(dir, exts, out = []) {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const p = join(full, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP.has(name)) walk(join(dir, name), exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(relPath(p));
    }
  }
  return out;
}

const relPath = (p) => relative(root, p).split(sep).join('/');

const read = (rel) => readFileSync(join(root, rel), 'utf8');

const violations = [];
const rule = (id, desc) => ({ id, desc, hits: [] });
const R = {
  L1: rule('L1', '组件（src/components）不得出现 ipc. / invoke('),
  L2: rule('L2', '状态容器（src/stores）不得出现 ipc. / invoke('),
  L3: rule('L3', '@tauri-apps/api/window 只允许被 src/lib/window.ts 引用'),
  L4: rule('L4', 'Rust infra 不得 use crate::services'),
  L5: rule('L5', 'Rust commands 不得 use crate::repositories'),
  L6: rule('L6', 'Rust 不得使用 eprintln!（用 crate::log_*!）'),
};

function scan(files, pattern, target, allow = () => false) {
  for (const rel of files) {
    if (allow(rel)) continue;
    const src = read(rel);
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (pattern.test(line)) target.hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      pattern.lastIndex = 0;
    });
  }
}

const feFiles = walk('src', ['.ts', '.tsx']);
scan(
  feFiles.filter((f) => f.startsWith('src/components/')),
  /\bipc\.|\binvoke\(/,
  R.L1,
);
scan(
  feFiles.filter((f) => f.startsWith('src/stores/')),
  /\bipc\.|\binvoke\(/,
  R.L2,
);
scan(feFiles, /@tauri-apps\/api\/window/, R.L3, (rel) => rel === 'src/lib/window.ts');

const rsFiles = walk('src-tauri/src', ['.rs']);
scan(
  rsFiles.filter((f) => f.startsWith('src-tauri/src/infra/')),
  /use crate::services/,
  R.L4,
);
scan(
  rsFiles.filter((f) => f.startsWith('src-tauri/src/commands/')),
  /use crate::repositories/,
  R.L5,
);
scan(rsFiles, /\beprintln!\(/, R.L6);

for (const r of Object.values(R)) if (r.hits.length) violations.push(r);

if (violations.length === 0) {
  console.log(`[layers] OK — ${Object.keys(R).length} 条分层规则全部通过（扫描 ${feFiles.length + rsFiles.length} 个文件）`);
  process.exit(0);
}

console.error('[layers] FAILED — 分层规则被破坏\n');
for (const r of violations) {
  console.error(`✗ ${r.id} ${r.desc}`);
  for (const hit of r.hits.slice(0, 12)) console.error(`    ${hit}`);
  if (r.hits.length > 12) console.error(`    … 另有 ${r.hits.length - 12} 处`);
}
console.error('\n规则全文见 docs/reviews/2026-10-18-ARCH-ASSESSMENT.md §3.4');
process.exit(1);
