#!/usr/bin/env node
/**
 * Timing — 单文件体积门禁（AGENTS.md「单文件 ≤600 有效行」的机械执行）
 * -----------------------------------------------------------------------------
 * 只看逻辑与样式源码：src/**（.ts/.tsx/.css）与 src-tauri/src/**（.rs）。
 * 不扫 tests 之外的生成物、不扫 node_modules / target / dist。
 *
 * **计数口径**：有效行 = 物理行去掉整行注释与空行。行尾注释不剥（那行本来就有代码）。
 * 词法扫描在 `size-measure.mjs`，字符串里的 `//`、Rust raw string、CSS `content:"/*"`
 * 都不会被误当注释 —— 误剥会让代码凭空「变小」，那是假绿，比超限更危险。
 *
 * 现存超限文件全部进入 `scripts/size-allowlist.json` 的**冻结基线**（由 `--freeze`
 * 扫描生成，不许手写）。基线是**棘轮**：
 *   · 当前有效行 > 冻结值 → 红（只许减不许增）；
 *   · 当前有效行 ≤ 冻结值 → 通过（缩了会提示跑 `--freeze` 收紧）；
 *   · 不在基线里且 >600 → 红（新超限文件必须拆，不能新增豁免）。
 *
 * 维护方式：拆分文件后跑 `node scripts/check-size.mjs --freeze` 重写基线；
 * 它是**收紧**操作的唯一入口，绝不允许为了变绿手工调大某个数字。
 *
 * [2026-11-19] 口径从「物理行」切到「有效行」，基线随之整体重记（129→122 条）。
 * 这是口径迁移、不是拆文件：豁免条数下降不代表债务消失，真实代码量未变。
 *
 * [2026-11-19] 上限 300 → 600 有效行，基线重记到 45 条。**这是尺子变了，不是债务
 * 消失**：落在 300–600 之间的那批文件从此不再受棘轮约束，可以一路涨到 600 才报警。
 * 豁免条数从 118 掉到 45 不代表借还得更多，别把它记成拆分成绩。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureSource } from './size-measure.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 600;
const COUNT_MODE = 'effective';
const MODE_LABEL = '有效行（不计注释与空行）';
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

function measure(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return measureSource(readFileSync(file, 'utf8'), ext);
}

const allowPath = join(root, 'scripts', 'size-allowlist.json');
const raw = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
const frozen = raw.files ?? {};
if (raw.mode && raw.mode !== COUNT_MODE) {
  console.error(
    `[size] 冻结基线的口径是 ${raw.mode}，当前脚本用 ${COUNT_MODE} —— ` +
      '两种口径的数值不可比，请先跑 `node scripts/check-size.mjs --freeze` 重记基线。',
  );
  process.exit(1);
}
const relOf = (file) => relative(root, file).split(sep).join('/');
const files = SCAN.flatMap((d) => walk(join(root, d)));
const measured = files.map((file) => {
  const { raw: physical, effective } = measure(file);
  return { rel: relOf(file), lines: effective, physical };
});

if (process.argv.includes('--freeze')) {
  const next = {};
  for (const { rel, lines } of measured.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (lines > LIMIT) next[rel] = lines;
  }
  const doc =
    `单文件 ≤${LIMIT} 有效行（物理行去掉整行注释与空行，AGENTS.md）的冻结基线。由 ` +
    '`node scripts/check-size.mjs --freeze` 扫描生成，禁止手写。语义是棘轮：每条的数值只许通过' +
    `重新 --freeze 下调，不允许调大；不在表里的文件超 ${LIMIT} 有效行直接失败。`;
  writeFileSync(
    allowPath,
    `${JSON.stringify({ _doc: doc, mode: COUNT_MODE, limit: LIMIT, files: next }, null, 2)}\n`,
    'utf8',
  );
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
/* [审计 2026-11-12] 只报「条数」会把问题藏起来。把「豁免行数 / 总行数」一起打出来，
   棘轮才有可收敛的目标。目标（主理人 2026-11-12 拍板）：**每版至少 −10 条**，
   0.15.0 前压到 100 条以内；未达标不得出包。
   [2026-11-19] 上限改 600 后这个 100 条是按 300 口径定的，两边不可比 —— 保留它当名义
   标尺，但**别把 45 条当达标庆祝**：豁免行数占比才是跨口径可比的数。 */
const totalLines = measured.reduce((n, m) => n + m.lines, 0);
const exemptLines = measured.reduce((n, m) => n + (m.lines > LIMIT ? m.lines : 0), 0);
const exemptPct = totalLines === 0 ? '0.0' : ((exemptLines / totalLines) * 100).toFixed(1);
const SIZE_TARGET = 100;
const targetNote =
  entries <= SIZE_TARGET
    ? `名义目标 ≤${SIZE_TARGET} 条已满足（该目标按 300 口径设定，跨口径不可比）`
    : `距名义目标（≤${SIZE_TARGET} 条，300 口径）还差 ${entries - SIZE_TARGET} 条`;
const summary =
  `扫描 ${files.length} 个文件，上限 ${LIMIT} ${MODE_LABEL}；冻结基线 ${entries} 条（棘轮：只许减不许增）；` +
  `超限文件占 ${exemptLines}/${totalLines} 有效行 = ${exemptPct}%；${targetNote}`;

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
for (const f of newOversized) console.error(`✗ ${f.rel} — ${f.lines} 有效行（超 ${f.lines - LIMIT}，不在冻结基线里）`);
for (const f of grown) console.error(`✗ ${f.rel} — ${f.lines} 有效行，超过冻结值 ${f.max}（+${f.lines - f.max}）；棘轮只许减不许增`);
console.error(`\n规则：单文件 ≤${LIMIT} ${MODE_LABEL} —— AGENTS.md 硬约束；超限文件只能拆分并跑 \`--freeze\` 收紧基线，`);
console.error('不允许手工调大 scripts/size-allowlist.json 的数值，也不允许新增豁免条目。');
process.exit(1);
