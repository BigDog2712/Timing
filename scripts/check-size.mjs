#!/usr/bin/env node
/**
 * Timing — 单文件体积门禁（AGENTS.md「单文件 ≤300 行」的机械执行）
 * -----------------------------------------------------------------------------
 * 只看逻辑与样式源码：src/**（.ts/.tsx/.css）与 src-tauri/src/**（.rs）。
 * 不扫 tests 之外的生成物、不扫 node_modules / target / dist。
 *
 * 白名单（scripts/size-allowlist.json）用于「已知超限、正在拆」的文件：
 * 每条必须带 owner + 到期日，到期后脚本直接失败——防止白名单变成永久豁免。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 300;
const SCAN = ['src', 'src-tauri/src'];
const EXT = new Set(['.ts', '.tsx', '.css', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'gen']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (EXT.has(name.slice(name.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/);
  // 末尾换行不算一行
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

const allowPath = join(root, 'scripts', 'size-allowlist.json');
const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
// `_doc` 之类的注释键不参与条目统计
for (const key of Object.keys(allow)) if (key.startsWith('_')) delete allow[key];
const today = new Date().toISOString().slice(0, 10);

const files = SCAN.flatMap((d) => walk(join(root, d)));
const oversized = [];
const violations = [];

/* vendored 子树口径（V0.12.0 融合 Patina）：
 *
 * 前端那半（`src/app/**`、`src/features/**`、`src/platform/**`、`src/shared/**`）与后端
 * 5 个 `insight/` 命名空间（`app` / `commands` / `infra` / `models` / `services`）
 * 都是 **原样并入的第三方源码**
 * （Patina 1.10.0，MIT），不是我们写的代码。它的文件尺寸归上游决定，我们也不该为了
 * 行数去改它 —— 拆完就等于放弃「diff 上游、按需同步」的能力，改一处变成逐行冲突。
 * 同理 `#![allow(dead_code)]` 也从单个子树根（原 `patina/mod.rs`）改成挂在 5 个
 * `pub mod insight;` 上的模块级 allow。
 *
 * 判据要窄：只认这几条路径前缀，`src/services/**` 之类宿主代码一条都不豁免。
 * 想从严就在下面把 VENDORED 置空，它会照旧逐个报错。 */
/* [0.12.0 T02] 后端 `src-tauri/src/patina/` 已按层归一，前缀换成 5 个 `insight/` 新根
 * （docs/refactor/patina-structural-merge.md §2.2）；前端 4 个根由 T01 定下，未动。 */
const VENDORED = [
  'src/app/',
  'src/features/',
  'src/platform/',
  'src/shared/',
  'src-tauri/src/app/insight/',
  'src-tauri/src/commands/insight/',
  'src-tauri/src/infra/insight/',
  'src-tauri/src/models/insight/',
  'src-tauri/src/services/insight/',
];
const isVendored = (rel) => VENDORED.some((prefix) => rel.startsWith(prefix));
const vendoredOversized = [];

for (const file of files) {
  const lines = lineCount(file);
  if (lines <= LIMIT) continue;
  const rel = relative(root, file).split(sep).join('/');
  if (isVendored(rel)) {
    vendoredOversized.push({ rel, lines });
    continue;
  }
  const entry = allow[rel];
  if (!entry) {
    oversized.push({ rel, lines });
    continue;
  }
  const problems = [];
  if (!entry.owner) problems.push('缺 owner');
  if (!entry.expires) problems.push('缺 expires');
  else if (entry.expires < today) problems.push(`已于 ${entry.expires} 到期`);
  if (problems.length) violations.push({ rel, lines, problems });
}

const stale = Object.keys(allow).filter((rel) => {
  const full = join(root, rel);
  return !existsSync(full) || lineCount(full) <= LIMIT;
});

const vendoredNote = vendoredOversized.length
  ? `；vendored 子树另有 ${vendoredOversized.length} 个超限文件（按 vendored 口径豁免，最大 ${vendoredOversized.reduce((m, f) => Math.max(m, f.lines), 0)} 行）`
  : '';
const summary = `扫描 ${files.length} 个文件，上限 ${LIMIT} 行${vendoredNote}`;

if (oversized.length === 0 && violations.length === 0) {
  const note = Object.keys(allow).length ? `（白名单 ${Object.keys(allow).length} 条）` : '';
  console.log(`[size] OK — ${summary}${note}`);
  if (stale.length) console.log(`[size] 提示：以下白名单条目已不再超限，可删除 —— ${stale.join(', ')}`);
  process.exit(0);
}

console.error(`[size] FAILED — ${summary}\n`);
for (const f of oversized) console.error(`✗ ${f.rel} — ${f.lines} 行（超 ${f.lines - LIMIT}）`);
for (const f of violations) console.error(`✗ ${f.rel} — ${f.lines} 行，白名单不合法：${f.problems.join(' / ')}`);
console.error('\n规则：单文件 ≤300 行（AGENTS.md 硬约束）；确需豁免请写入 scripts/size-allowlist.json 并带 owner + 到期日。');
process.exit(1);
