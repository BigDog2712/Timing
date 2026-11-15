#!/usr/bin/env node
/**
 * Timing — 运行时标识符一致性门禁（去 Patina 化 T04-1 / 设计 §6 G1）
 * -----------------------------------------------------------------------------
 * 判据是**跨文件一致性**（"多处说的是不是同一个名字"），不是"名字是不是 activity"。
 * 这条区别是本脚本能在改名**之前**就落地并全绿的原因：改名前它验 `patina` 三处一致，
 * 改名后它验 `activity` 三处一致，改名的中间态（只改了 Rust 没改 capability）才会红。
 *
 * ## 为什么需要它（设计 §1.5 / §3.1）
 *
 * 窗口 label 是**字符串**，它的三处引用互相之间没有任何编译期约束：
 *   ① Rust `MAIN_WINDOW_LABEL`（建窗用）；
 *   ② `capabilities/*.json` 的 `windows[]`（ACL 按 label 决定这扇窗能调哪些命令）；
 *   ③ 前端 `windowControlGateway.ts` 的 `MAIN_WINDOW_LABEL`（按 label 认自己是谁）。
 * 三者漂一个的症状**全是静默的**：
 *   · ①② 漂 ⇒ Tauri ACL 判「这扇窗没被授权」⇒ 该窗所有 IPC 返回
 *     "<cmd> not allowed. Command not found"，界面能渲染、数据全空、控制台零日志；
 *   · ①③ 漂 ⇒ 前端认为自己不是分析窗 ⇒ ready 永不回执，浮层永远"未就绪"。
 * `npm run check` 之前对此**完全失明**（连 `cargo test` 都不在八步里）。
 *
 * ## 七个子判据（a–g）
 *
 * | 子判据 | 内容 |
 * |---|---|
 * | a | Rust 三个 label 常量互不相同（建窗撞 label 会 `Err`） |
 * | b | 前端 `MAIN_WINDOW_LABEL` == Rust `MAIN_WINDOW_LABEL`（逐字） |
 * | c | `capabilities/*.json` 的 `windows[]` ↔ Rust 建窗点**双向包含** |
 * | d | `WebviewUrl::App("x.html")` / dev URL 的每个 `x.html` 存在且是 vite 入口 |
 * | e | `get_webview_window("…")` 裸字面量**只许减**（棘轮，目标 0） |
 * | f | Rust 两个全局属性名必须在前端逐字出现（名字漂 = 桥静默断） |
 * | g | `resolveCurrentAppWindowLabel()` 仍含 `main`/`mini`/`tool-notification` |
 *
 * ## 自我防伪（设计 §6 末 · 同 `check-layers` 哨兵纪律）
 *
 * 末尾打印**每个子判据的实际计数**，任一为 0 即失败。"扫空集合后全绿"是本仓踩过的
 * 坑：正则写错、目录改名、路径调整都会让规则安静地不再命中，而输出仍然是"全部通过"。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, ext, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) {
      if (name === 'target' || name === 'node_modules') continue;
      walk(rel, ext, out);
    } else if (name.endsWith(ext)) out.push(rel);
  }
  return out;
}

const RS_FILES = walk('src-tauri/src', '.rs');
const rsSources = new Map(RS_FILES.map((f) => [f, read(f)]));
const TS_FILES = walk('src', '.ts').concat(walk('src', '.tsx'));

const failures = [];
const counts = [];
const record = (key, n) => counts.push(`${key}=${n}`);

/** 找 `const NAME: &str = "value";` 的字面值（全 Rust 源）。 */
function rustConst(name) {
  const re = new RegExp(`const\\s+${name}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`);
  for (const [file, src] of rsSources) {
    const m = src.match(re);
    if (m) return { value: m[1], where: `${file} (const ${name})` };
  }
  return null;
}

/* ── a · 三个 label 常量互不相同 ─────────────────────────────────────────────
 *
 * `MINI_WINDOW_LABEL` 在 T04-2 才引入。**在本批（T04-1）它还不存在**，而门禁必须在
 * 改名前后都绿 ⇒ 缺失时回落到「建窗点的裸字面量」，并在输出里标明来源是回落。
 * 这不是放宽判据：两种取值的**一致性比较**完全相同，区别只在"名字从哪读"。
 * T04-2 引入常量后自动切回常量路径（见 T04-2 的收尾判据 e 计数归零）。
 */
function miniLabel() {
  const viaConst = rustConst('MINI_WINDOW_LABEL');
  if (viaConst) return { ...viaConst, source: 'const' };
  const native = rsSources.get('src-tauri/src/app/activity/mini_window/native.rs') ?? '';
  const m = native.match(/WebviewWindowBuilder::new\(\s*app\s*,\s*"([^"]+)"/);
  return m ? { value: m[1], where: 'app/activity/mini_window/native.rs 建窗点', source: 'literal' } : null;
}

const labelMain = rustConst('MAIN_WINDOW_LABEL');
const labelMini = miniLabel();
const labelTool = rustConst('WINDOW_LABEL');

const labelsOk = [labelMain, labelMini, labelTool].every(Boolean);
if (!labelsOk) {
  const missing = [
    labelMain ? null : 'MAIN_WINDOW_LABEL',
    labelMini ? null : 'mini label（常量与建窗点都没有）',
    labelTool ? null : 'tool_notifications::WINDOW_LABEL',
  ].filter(Boolean);
  failures.push(`a: 解析不出 ${missing.join(' / ')} —— 常量可能改名了，先修本脚本的正则`);
} else {
  const values = [labelMain.value, labelMini.value, labelTool.value];
  const dup = values.find((v, i) => values.indexOf(v) !== i);
  if (dup) {
    failures.push(
      `a: 两个 label 取了同一个值 "${dup}" —— 建窗会返 Err（"a webview with label ... already exists"），` +
        '且后建的那扇窗会静默继承前一扇的 ACL',
    );
  }
  record('a', new Set(values).size);
  console.log(
    `[runtime-ids] a: main="${labelMain.value}" · mini="${labelMini.value}"(${labelMini.source}) · ` +
      `tool-notification="${labelTool.value}"`,
  );
}

/* ── b · 前端 MAIN_WINDOW_LABEL 逐字等于 Rust ─────────────────────────────── */
const GATEWAY = 'src/windows/activity/platform/desktop/windowControlGateway.ts';
const gatewaySrc = read(GATEWAY);
const feLabel = gatewaySrc.match(/const\s+MAIN_WINDOW_LABEL\s*=\s*"([^"]+)"/);
if (!feLabel) {
  failures.push(`b: ${GATEWAY} 里找不到 \`const MAIN_WINDOW_LABEL = "…"\``);
} else if (!labelMain) {
  failures.push('b: Rust 侧 MAIN_WINDOW_LABEL 解析失败（见 a），无法比对');
} else {
  record('b', 1);
  console.log(`[runtime-ids] b: 前端="${feLabel[1]}" · Rust="${labelMain.value}"`);
  if (feLabel[1] !== labelMain.value) {
    failures.push(
      `b: 前端 MAIN_WINDOW_LABEL="${feLabel[1]}" 与 Rust MAIN_WINDOW_LABEL="${labelMain.value}" 不一致 —— ` +
        '前端会认为自己不是分析窗，ready 永不回执（浮层永远"未就绪"）',
    );
  }
}

/* ── c · capability windows[] ↔ Rust 建窗点（双向包含）───────────────────── */
const CAP_DIR = 'src-tauri/capabilities';
const capabilities = readdirSync(join(root, CAP_DIR))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: `${CAP_DIR}/${f}`, json: JSON.parse(read(`${CAP_DIR}/${f}`)) }));

/** capability 的 windows 条目可能是通配（`note-*`）。 */
const asPattern = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

const buildSites = [];
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
for (const w of conf.app?.windows ?? conf.tauri?.windows ?? []) {
  buildSites.push({ label: w.label, where: 'src-tauri/tauri.conf.json' });
}
for (const [file, src] of rsSources) {
  if (!file.startsWith('src-tauri/src/app/activity/')) continue;
  for (const m of src.matchAll(/WebviewWindowBuilder::new\(\s*app\s*,\s*([^,]+),/g)) {
    const arg = m[1].trim();
    const literal = /^"([^"]+)"$/.exec(arg);
    if (literal) buildSites.push({ label: literal[1], where: file });
    else if (/^[A-Z][A-Z0-9_]*$/.test(arg)) {
      const c = rustConst(arg);
      if (c) buildSites.push({ label: c.value, where: `${file} (${arg})` });
      else failures.push(`c: ${file} 用常量 ${arg} 建窗，但该常量解析不出字面值`);
    }
  }
}
const notePrefix = rustConst('NOTE_LABEL_PREFIX');
for (const m of (rsSources.get('src-tauri/src/infra/window_spec.rs') ?? '').matchAll(/^\s*label:\s*"([^"]+)"/gm)) {
  /* `label: "note"` 是 **spec 键**，不是真实窗口 label：便利贴窗实际用
   * `note_label(id)` = `note-{id}` 建（`format!("{NOTE_LABEL_PREFIX}{id}")`）。
   * 把 spec 键当 label 会让判据要求 capability 去覆盖一个从不存在的窗名。 */
  if (notePrefix && notePrefix.value === `${m[1]}-`) continue;
  buildSites.push({ label: m[1], where: 'src-tauri/src/infra/window_spec.rs' });
}
if (notePrefix) {
  buildSites.push({ label: `${notePrefix.value}*`, where: 'src-tauri/src/infra/window_spec.rs (note_label)' });
}

/* `settings` 窗在 T04 之前就没有任何 capability 覆盖（预存在缺口，§1.5 已登记）。
 * 这里**点名豁免并锁死**：新增一扇没被覆盖的窗会红；`settings` 哪天被覆盖了也会红
 * （提示把这行删掉并收紧判据）—— 豁免表必须与现状精确相等，不是"允许缺失"。 */
const KNOWN_UNCOVERED = ['settings'];

const capWindows = capabilities.flatMap((cap) =>
  (cap.json.windows ?? []).map((pattern) => ({ pattern, file: cap.file })),
);
for (const { pattern, file } of capWindows) {
  const hit = buildSites.some((site) => asPattern(pattern).test(site.label));
  if (!hit) failures.push(`c: capability windows 里的 ${pattern} 找不到建窗点（${file}）`);
}
const uncovered = [...new Set(buildSites.map((s) => s.label))].filter(
  (label) => !capWindows.some(({ pattern }) => asPattern(pattern).test(label)),
);
for (const label of uncovered) {
  if (!KNOWN_UNCOVERED.includes(label)) {
    failures.push(`c: Rust 建窗点 "${label}" 没有被任何 capability 的 windows[] 覆盖 —— 这扇窗的 IPC 会被 ACL 全拒`);
  }
}
for (const label of KNOWN_UNCOVERED) {
  if (!uncovered.includes(label)) {
    failures.push(`c: "${label}" 已被 capability 覆盖，请从 KNOWN_UNCOVERED 删掉这一项并收紧判据`);
  }
}
record('c', capWindows.length);
console.log(
  `[runtime-ids] c: capability 窗口条目 ${capWindows.length} 个 · Rust 建窗点 ${new Set(buildSites.map((s) => s.label)).size} 个 · ` +
    `预存在未覆盖 ${KNOWN_UNCOVERED.length} 个（${KNOWN_UNCOVERED.join(' / ')}）`,
);

/* ── d · 入口页存在且登记为 vite 入口 ─────────────────────────────────────── */
const htmlRefs = new Set();
for (const [, src] of rsSources) {
  for (const m of src.matchAll(/WebviewUrl::App\(\s*"([A-Za-z0-9_-]+\.html)"/g)) htmlRefs.add(m[1]);
  for (const m of src.matchAll(/:1420\/([A-Za-z0-9_-]+\.html)/g)) htmlRefs.add(m[1]);
}
const viteSrc = read('vite.config.ts');
const viteInputs = new Set([...viteSrc.matchAll(/entry\(\s*'\.\/([A-Za-z0-9_-]+\.html)'\s*\)/g)].map((m) => m[1]));
if (htmlRefs.size === 0) failures.push('d: 一个 .html 入口都没解析出来 —— 建窗点的 WebviewUrl 写法可能变了');
for (const html of htmlRefs) {
  if (!existsSync(join(root, html))) failures.push(`d: Rust 引用了 ${html}，但仓根没有这个文件`);
  if (!viteInputs.has(html)) failures.push(`d: Rust 引用了 ${html}，但 vite.config.ts 的 input 里没有它（打包后 404）`);
}
record('d', htmlRefs.size);
console.log(`[runtime-ids] d: 入口页 ${[...htmlRefs].join(' / ')} · vite 入口 ${[...viteInputs].join(' / ')}`);

/* ── e · get_webview_window("…") 裸字面量棘轮（目标 0）────────────────────
 * 裸字面量是「label 改名漏一处」的温床：常量改了、这里还是旧值，表现为「窗开出来了却拿不到」。 */
const RAW_LITERAL_BUDGET = 10;
const rawLiterals = [];
for (const [file, src] of rsSources) {
  for (const m of src.matchAll(/get_webview_window\(\s*"([^"]*)"/g)) {
    rawLiterals.push({ file, label: m[1] });
  }
}
record('e', rawLiterals.length);
console.log(
  `[runtime-ids] e: get_webview_window 裸字面量 ${rawLiterals.length} 处（预算 ${RAW_LITERAL_BUDGET}，目标 0）` +
    (rawLiterals.length ? `：${[...new Set(rawLiterals.map((r) => r.label))].join(' / ')}` : ''),
);
if (rawLiterals.length > RAW_LITERAL_BUDGET) {
  failures.push(
    `e: 裸字面量从预算 ${RAW_LITERAL_BUDGET} 涨到 ${rawLiterals.length} 处 —— ` +
      `新增的：${rawLiterals.map((r) => `${r.file}:${r.label}`).join('、')}。请改用 label 常量`,
  );
}

/* ── f · 全局属性名两侧逐字一致 ───────────────────────────────────────────── */
const GLOBAL_PROPS = ['MAIN_WINDOW_GENERATION_PROPERTY', 'MAIN_WINDOW_LIVENESS_CALLBACK'];
let propsMirrored = 0;
for (const name of GLOBAL_PROPS) {
  const c = rustConst(name);
  if (!c) {
    failures.push(`f: Rust 里找不到 ${name} 的字面值`);
    continue;
  }
  const hit = TS_FILES.some((f) => read(f).includes(c.value));
  if (!hit) {
    failures.push(`f: Rust 的 ${name}="${c.value}" 在前端源码里一次都没出现 —— 桥的名字漂了，握手会静默失败`);
    continue;
  }
  propsMirrored += 1;
}
record('f', propsMirrored);
console.log(`[runtime-ids] f: 全局属性名镜像 ${propsMirrored}/${GLOBAL_PROPS.length} 对`);

/* ── g · DOM 身份（data-window-label）必须保留三个身份 ─────────────────────
 *
 * `resolveCurrentAppWindowLabel()` 把非 mini/tool-notification 的 label 一律折成
 * `"main"`，于是 **DOM 身份 = main、原生 label = activity**，两者故意不一致。
 * 谁"顺手统一"了它，`html[data-window-label="main"]` 的首屏背景立即失效。 */
const resolveFn = gatewaySrc.match(/resolveCurrentAppWindowLabel\(\)[^{]*\{[\s\S]*?\n\}/);
const DOM_LABELS = ['"main"', '"mini"', '"tool-notification"'];
if (!resolveFn) {
  failures.push(`g: ${GATEWAY} 里找不到 resolveCurrentAppWindowLabel 的函数体`);
} else {
  const found = DOM_LABELS.filter((label) => resolveFn[0].includes(label));
  record('g', found.length);
  console.log(`[runtime-ids] g: DOM 身份字面量 ${found.length}/${DOM_LABELS.length} 个（${found.join(' ')}）`);
  for (const label of DOM_LABELS) {
    if (!found.includes(label)) {
      failures.push(`g: resolveCurrentAppWindowLabel 里少了 ${label} —— DOM 身份折叠被改坏，首屏背景/CSS 会静默失效`);
    }
  }
}

/* ── 自我防伪 ─────────────────────────────────────────────────────────────── */
const empty = counts.filter((entry) => entry.endsWith('=0'));
if (empty.length > 0) {
  failures.push(`哨兵：这些子判据的计数为 0，说明规则在空转 —— ${empty.join(' ')}`);
}

if (failures.length > 0) {
  console.error('[runtime-ids] FAILED — 运行时标识符不一致\n');
  for (const f of failures) console.error(`✗ ${f}`);
  console.error('\n规则：窗口 label 是字符串，三处引用之间没有编译期约束。');
  console.error('改 label / capability / 前端常量时，必须同批改并让本脚本重新全绿。');
  process.exit(1);
}

console.log(`[runtime-ids] OK — 7 条子判据全部通过（${counts.join(' ')}）`);
