#!/usr/bin/env node
/**
 * Timing — 单文件体积门禁（AGENTS.md「单文件 ≤300 行」的机械执行）
 * -----------------------------------------------------------------------------
 * 只看逻辑与样式源码：src/**（.ts/.tsx/.css）与 src-tauri/src/**（.rs）。
 * 不扫 tests 之外的生成物、不扫 node_modules / target / dist。
 *
 * [0.12.0 T04] 路径豁免已撤销：Patina 归一后每条路径都受同一把尺子。
 * 现存超限文件全部进入 `scripts/size-allowlist.json` 的**冻结基线**（152 条，由
 * `--freeze` 扫描生成，不许手写）。基线是**棘轮**：
 *   · 当前行数 > 冻结值 → 红（只许减不许增）；
 *   · 当前行数 ≤ 冻结值 → 通过（缩了会提示跑 `--freeze` 收紧）；
 *   · 不在基线里且 >300 → 红（新超限文件必须拆，不能新增豁免）。
 *
 * 维护方式：拆分文件后跑 `node scripts/check-size.mjs --freeze` 重写基线；
 * 它是**收紧**操作的唯一入口，绝不允许为了变绿手工调大某个数字。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
const raw = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
const frozen = raw.files ?? {};
const relOf = (file) => relative(root, file).split(sep).join('/');
const files = SCAN.flatMap((d) => walk(join(root, d)));
const measured = files.map((file) => ({ rel: relOf(file), lines: lineCount(file) }));

if (process.argv.includes('--freeze')) {
  const next = {};
  for (const { rel, lines } of measured.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (lines > LIMIT) next[rel] = lines;
  }
  const doc =
    '单文件 ≤300 行（AGENTS.md）的冻结基线。由 `node scripts/check-size.mjs --freeze` 扫描生成，' +
    '禁止手写。语义是棘轮：每条的数值只许通过重新 --freeze 下调，不允许调大；' +
    '不在表里的文件超 300 行直接失败。';
  writeFileSync(allowPath, `${JSON.stringify({ _doc: doc, limit: LIMIT, files: next }, null, 2)}\n`, 'utf8');
  console.log(`[size] FREEZE — 已写入 ${Object.keys(next).length} 条冻结基线（scripts/size-allowlist.json）`);
  process.exit(0);
}

const newOversized = [];
const grown = [];
const tightened = [];
for (const { rel, lines } of measured) {
  if (lines <= LIMIT) continue;
  if (!(rel in frozen)) {
    newOversized.push({ rel, lines });
    continue;
  }
  const max = typeof frozen[rel] === 'number' ? frozen[rel] : Number(frozen[rel]?.maxLines);
  if (!Number.isFinite(max)) {
    newOversized.push({ rel, lines });
    continue;
  }
  if (lines > max) grown.push({ rel, lines, max });
  else if (lines < max) tightened.push({ rel, lines, max });
}

const measuredByRel = new Map(measured.map((m) => [m.rel, m.lines]));
const stale = Object.keys(frozen).filter((rel) => {
  const lines = measuredByRel.get(rel);
  return lines === undefined || lines <= LIMIT;
});

const entries = Object.keys(frozen).length;
const summary = `扫描 ${files.length} 个文件，上限 ${LIMIT} 行；冻结基线 ${entries} 条（棘轮：只许减不许增）`;

if (newOversized.length === 0 && grown.length === 0) {
  console.log(`[size] OK — ${summary}`);
  if (tightened.length) {
    console.log(
      `[size] 提示：${tightened.length} 个条目已低于冻结值，可跑 \`--freeze\` 收紧 —— ` +
        tightened.map((f) => `${f.rel}(${f.max}→${f.lines})`).join(', '),
    );
  }
  if (stale.length) console.log(`[size] 提示：以下条目已不超限或文件已消失，跑 \`--freeze\` 会移除 —— ${stale.join(', ')}`);
  process.exit(0);
}

console.error(`[size] FAILED — ${summary}\n`);
for (const f of newOversized) console.error(`✗ ${f.rel} — ${f.lines} 行（超 ${f.lines - LIMIT}，不在冻结基线里）`);
for (const f of grown) console.error(`✗ ${f.rel} — ${f.lines} 行，超过冻结值 ${f.max}（+${f.lines - f.max}）；棘轮只许减不许增`);
console.error('\n规则：单文件 ≤300 行（AGENTS.md 硬约束）；超限文件只能拆分并跑 `--freeze` 收紧基线，');
console.error('不允许手工调大 scripts/size-allowlist.json 的数值，也不允许新增豁免条目。');
process.exit(1);
