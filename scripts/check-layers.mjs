#!/usr/bin/env node
/**
 * Timing — 分层门禁（把架构规则变成 grep，而不是 code review 的口头约定）
 * -----------------------------------------------------------------------------
 * 规则来自 `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` §3.4（R1~R6/R10），
 * T04 起扩围 / 新增 L9（见 `docs/refactor/patina-structural-merge.md` §4.6 / §T04）：
 *
 *   L1 组件不得触碰传输层：`ipc.` / `invoke(` 在 src/components、src/app|features|shared
 *      下的 components/ 子目录中 0 命中
 *   L2 状态容器不得触碰传输层：src/stores、src/**\/*Store.ts、src/features/**\/stores 下 0 命中
 *   L3 窗口 API 只能经 `src/lib/windowApi.ts`：全仓只有它 import
 *      `@tauri-apps/api/window` 或 `@tauri-apps/api/webviewWindow`
 *   L4 Rust `infra` 不得依赖 `services`（解环，见 ADR-016）
 *   L5 Rust `commands` 不得直接依赖 `repositories`（必须经 service）
 *   L6 Rust 全域不得出现 `eprintln!`（结构化日志，见 platform/log.rs）
 *   L7 编译期平台常量 `__TIMING_MOBILE__` 只允许出现在 `src/lib/platform.ts`
 *   L8 业务写入信号 `dirty::mark(` 只允许出现在 `src-tauri/src/commands/`
 *      （`jobs/` 与 `services/` 下 0 命中；见下方 L8 哨兵）
 *   L9 双窗隔离：主窗（components/hooks/lib/mocks/services/stores/styles/types）与分析窗
 *      （app/features/platform/shared）不得互相 import；例外只有三类：零业务依赖的
 *      `src/lib/windowApi.ts`（窗口 API 薄壳）、`src-tauri/icons/**` 静态资源，
 *      以及 `src/lib/handle*` 两个纯数据 / 纯 IO 模块（手柄目录与绑定读写，见下方
 *      `L9_ALLOWED_TARGETS` 的说明 —— 它们是**两窗唯一合法的共享载体**）。
 *
 * 每一条都是「改坏了 CI 就红」的判据，而不是「建议」。
 *
 * ## L7 / L8 / L9 的哨兵（防「绿着空转」）
 *
 * L7 / L8 都是**按符号名 grep** 的规则：符号一改名而本脚本没跟着改，规则就会去扫
 * 一个根本不存在的符号，于是打印「N 条规则全部通过」，而保护已经消失（PRD R7 警告
 * 的最隐蔽回归）。所以末尾有哨兵：L7 要求该常量同时出现在「声明处 + 两处 define」；
 * L8 要求 `dirty.rs` 里真的存在 `pub fn mark(`。少一处即红色退出，逼人一起改。
 *
 * L9 是「按路径集合 + import 解析」的规则，最容易因为根目录写错而两个集合都为空、
 * 于是永远不命中。哨兵要求主窗/分析窗两条路径集合都非空，且真的解析出了相对 import。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * L7 扫描的编译期平台常量（**唯一口径**）。
 * 改名时必须同时改：`src/lib/platform.ts` 的 `declare const`、`vite.config.ts` 与
 * `vitest.config.ts` 的 `define` 键、本常量。哨兵会校验三处一致。
 */
const PLATFORM_SYMBOL = '__TIMING_MOBILE__';

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

/** 目录路径里是否含有名为 `segment` 的一级（不含文件名）。 */
const inDirNamed = (rel, segment) => rel.split('/').slice(0, -1).includes(segment);

/* [0.12.0 T04] 路径豁免已全部撤销：
 * Patina 已归一（T01–T03），没有「门禁不管」的代码。规则回到全仓统一口径。 */
const L1_ROOTS = ['src/components/'];
const L1_COMPONENT_ROOTS = ['src/app/', 'src/features/', 'src/shared/'];
const L2_ROOTS = ['src/stores/'];
const L2_FEATURE_STORES = 'src/features/';
const L2_SUFFIX = /(^|\/)[^/]*Store\.ts$/;

const L3_ALLOWED = new Set(['src/lib/windowApi.ts']);
const L3_PATTERN = /@tauri-apps\/api\/(?:webviewWindow|window)/;

/* L9 双窗：主窗 = 宿主 UI 与传输/状态层；分析窗 = 归一的 Patina 四域。 */
const L9_MAIN_ROOTS = [
  'src/components/',
  'src/hooks/',
  'src/lib/',
  'src/mocks/',
  'src/services/',
  'src/stores/',
  'src/styles/',
  'src/types/',
];
const L9_ANALYSIS_ROOTS = ['src/app/', 'src/features/', 'src/platform/', 'src/shared/'];
/* 允许被分析窗 import 的**主窗**模块（白名单只增不减，且每一条都必须真实存在，
 * 由下方 L9 哨兵校验）：
 *  - `windowApi`：窗口 API 薄壳，只 re-export `@tauri-apps/api/*`，零业务依赖。
 *  - `handleCatalog`：手柄动作目录，**纯数据 + 零 import**；
 *  - `handleBindings`：手柄绑定读写，**纯函数 + localStorage**，只 import 前者；
 *  - `pillAppearance`：药丸外观（文字/背景不透明度、常驻形态）的**纯数据 + 纯 IO**，
 *    只 import `lib/storageKeys`（同属 `src/lib`，不越界）；[0.12.1 T04] 设置搬进主界面后，
 *    主界面的外观卡与宿主药丸必须写同一个键，而写路径只能有一条。
 * 前三条存在的理由：设置页（分析窗 `src/features/settings/**`）必须能读写手柄绑定，
 * 而分析窗读不到宿主 `src/services/**`（runner）与 `src/stores/**`（appearanceStore 带
 * zustand 与副作用，加进来等于双窗隔离作废）。所以「能被两窗共享的东西」只能是
 * 无状态、无传输层依赖的纯模块 —— 这不是洁癖，是门禁的硬约束。
 * 反例（别照着抄）：任何带 `useState` / `zustand` / `invoke` 的模块都不许进这张表。 */
const L9_ALLOWED_TARGETS = new Set([
  'src/lib/windowApi',
  'src/lib/handleCatalog',
  'src/lib/handleBindings',
  'src/lib/pillAppearance',
]);

const violations = [];
const rule = (id, desc) => ({ id, desc, hits: [] });
const R = {
  L1: rule('L1', '组件（src/components 与 app|features|shared 下的 components/）不得出现 ipc. / invoke('),
  L2: rule('L2', '状态容器（src/stores、*Store.ts、features/**/stores）不得出现 ipc. / invoke('),
  L3: rule('L3', '@tauri-apps/api/window 与 webviewWindow 只允许被 src/lib/windowApi.ts 引用'),
  L4: rule('L4', 'Rust infra 不得 use crate::services'),
  L5: rule('L5', 'Rust commands 不得 use crate::repositories'),
  L6: rule('L6', 'Rust 不得使用 eprintln!（用 crate::log_*!）'),
  L7: rule('L7', `编译期平台常量 ${PLATFORM_SYMBOL} 只允许出现在 src/lib/platform.ts`),
  L8: rule('L8', '业务写入信号 dirty::mark( 只允许出现在 src-tauri/src/commands/'),
  L9: rule(
    'L9',
    '双窗隔离：主窗与分析窗不得互相 import（例外 windowApi.ts / lib/handleCatalog / lib/handleBindings / icons 资源）',
  ),
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
  feFiles.filter(
    (f) =>
      L1_ROOTS.some((p) => f.startsWith(p)) ||
      (L1_COMPONENT_ROOTS.some((p) => f.startsWith(p)) && inDirNamed(f, 'components')),
  ),
  /\bipc\.|\binvoke\(/,
  R.L1,
);
scan(
  feFiles.filter(
    (f) =>
      L2_ROOTS.some((p) => f.startsWith(p)) ||
      L2_SUFFIX.test(f) ||
      (f.startsWith(L2_FEATURE_STORES) && inDirNamed(f, 'stores')),
  ),
  /\bipc\.|\binvoke\(/,
  R.L2,
);
scan(feFiles, L3_PATTERN, R.L3, (rel) => L3_ALLOWED.has(rel));

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

/* L7：平台常量是「编译期一次性替换」的全局，散落读取会让分支不可枚举、
   也让「桌面产物里不该有移动代码」这条摇树前提失效。唯一读取点是 platform.ts。 */
scan(feFiles, new RegExp(PLATFORM_SYMBOL), R.L7, (rel) => rel === 'src/lib/platform.ts');

/* L8：脏标记是白名单（设计 §4.6），唯一合法信号源是命令层的 25 处业务写入。
   批 1 的自检清单只有一条人工 `grep -rn "dirty::mark" src-tauri/src/jobs/`，
   `services/` 完全没查；而 T04 新增的 `services/md_cloud/purge/*` 会写
   `md_cloud.purge.*` KV —— 这正是「没有任何门禁看着」的写盘触发器：
   一处误标就会把秒级心跳变成全天持续写 md + 每轮一份备份。
   把整条白名单固化成机器规则：jobs/ 与 services/ 一律 0 命中。 */
scan(
  rsFiles.filter(
    (f) =>
      f.startsWith('src-tauri/src/jobs/') ||
      f.startsWith('src-tauri/src/services/'),
  ),
  /\bdirty::mark\s*\(/,
  R.L8,
);

/* L9：解析相对 import，跨窗即红。
 *
 * 只认相对路径：本仓**没有** `@/` 路径别名（tsconfig 无 paths、vite 无 resolve.alias，
 * §7 R3 已实测），所以 `from '../../app/x'` 是唯一跨窗写法。`from 'x'` 一类包名
 * （`react`、`@tauri-apps/*`）不参与。 */
const L9_SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g, // import ... from / export ... from
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // 动态 import()
  /^\s*import\s*['"]([^'"]+)['"]/gm, // 副作用 import
];

function relativeSpecifiers(src) {
  const out = [];
  for (const re of L9_SPECIFIER_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) if (m[1].startsWith('.')) out.push(m[1]);
  }
  return out;
}

const L9_MAIN_FILES = feFiles.filter((f) => L9_MAIN_ROOTS.some((p) => f.startsWith(p)));
const L9_ANALYSIS_FILES = feFiles.filter((f) => L9_ANALYSIS_ROOTS.some((p) => f.startsWith(p)));
const L9_ALLOWED_NORMALIZED = new Set([...L9_ALLOWED_TARGETS].map((p) => p.replace(/\.(tsx?|jsx?)$/, '')));

let l9SpecifierCount = 0;
function scanWindowCross(files, targetRoots, target) {
  for (const rel of files) {
    for (const spec of relativeSpecifiers(read(rel))) {
      l9SpecifierCount++;
      const targetRel = relPath(resolve(root, dirname(rel), spec));
      const normalized = targetRel.replace(/\.(tsx?|jsx?)$/, '');
      if (L9_ALLOWED_NORMALIZED.has(normalized)) continue;
      if (targetRoots.some((p) => targetRel.startsWith(p))) {
        target.hits.push(`${rel} → ${targetRel}  (${spec})`);
      }
    }
  }
}
scanWindowCross(L9_MAIN_FILES, L9_ANALYSIS_ROOTS, R.L9);
scanWindowCross(L9_ANALYSIS_FILES, L9_MAIN_ROOTS, R.L9);

/* L7 哨兵：被扫描的符号必须真的存在（否则规则「绿着空转」）。 */
const SENTINEL_SITES = [
  ['src/lib/platform.ts', `declare const ${PLATFORM_SYMBOL}`],
  ['vite.config.ts', `${PLATFORM_SYMBOL}:`],
  ['vitest.config.ts', `${PLATFORM_SYMBOL}:`],
];
const sentinelFailures = [];
for (const [file, needle] of SENTINEL_SITES) {
  if (!existsSync(join(root, file))) {
    sentinelFailures.push(`${file} 不存在；哨兵要求它里面出现 ${needle}`);
    continue;
  }
  if (!read(file).includes(needle)) sentinelFailures.push(`${file} 里找不到 ${needle}`);
}
if (sentinelFailures.length) {
  console.error('[layers] FAILED — L7 哨兵未通过：L7 扫描的符号在代码里不存在\n');
  for (const line of sentinelFailures) console.error(`  ✗ ${line}`);
  console.error(`\n规则：L7 的正则用的是本脚本的 PLATFORM_SYMBOL = '${PLATFORM_SYMBOL}'。`);
  console.error('符号改名时必须同批改本常量（否则 L7 会「绿着空转」——门禁绿但保护消失）。');
  process.exit(1);
}

/* L8 哨兵：L8 扫的是字面量 `dirty::mark(`。若 `dirty.rs` 里把 `mark` 改了名
   （或整个模块搬走），规则会去扫一个不存在的符号、打印「8 条规则全部通过」，
   而白名单保护已经消失 —— 与 L7 完全同型的坑。要求定义处逐字仍在。 */
const L8_SENTINEL_SITES = [
  ['src-tauri/src/services/md_sync/dirty.rs', 'pub fn mark('],
];
const l8SentinelFailures = [];
for (const [file, needle] of L8_SENTINEL_SITES) {
  if (!existsSync(join(root, file))) {
    l8SentinelFailures.push(`${file} 不存在；哨兵要求它里面出现 ${needle}`);
    continue;
  }
  if (!read(file).includes(needle)) l8SentinelFailures.push(`${file} 里找不到 ${needle}`);
}
if (l8SentinelFailures.length) {
  console.error('[layers] FAILED — L8 哨兵未通过：脏标记的定义不在预期位置\n');
  for (const line of l8SentinelFailures) console.error(`  ✗ ${line}`);
  console.error('\n规则：L8 的正则写死 `\\bdirty::mark\\s*\\(`。符号改名时必须同批改本规则与哨兵，');
  console.error('否则 L8 会「绿着空转」——门禁绿但白名单保护消失（同 L7 的坑）。');
  process.exit(1);
}

/* L9 哨兵：两条路径集合必须非空，且 import 解析真的在工作。
 * 根目录改名 / 正则写坏都会让 L9 永远不命中（比红更危险）。 */
const l9SentinelFailures = [];
if (L9_MAIN_FILES.length === 0) l9SentinelFailures.push('主窗路径集合为空（L9_MAIN_ROOTS 是否写错？）');
if (L9_ANALYSIS_FILES.length === 0) l9SentinelFailures.push('分析窗路径集合为空（L9_ANALYSIS_ROOTS 是否写错？）');
if (l9SpecifierCount === 0) l9SentinelFailures.push('两窗内没有解析出任何相对 import（说明符正则坏了？）');
/* 例外清单必须指向真实存在的文件：`src/lib/windowApi` 被改名/搬走后，L9_ALLOWED_TARGETS
 * 会静默变成一张空头支票；后来的人只会看到「例外还有空位」，顺势再塞几条。 */
for (const target of L9_ALLOWED_TARGETS) {
  if (!['.ts', '.tsx'].some((ext) => existsSync(join(root, `${target}${ext}`)))) {
    l9SentinelFailures.push(
      `例外目标 ${target} 不存在（L9_ALLOWED_TARGETS 是否写错？重命名薄壳必须同批更新）`,
    );
  }
}
if (l9SentinelFailures.length) {
  console.error('[layers] FAILED — L9 哨兵未通过：双窗隔离规则会「绿着空转」\n');
  for (const line of l9SentinelFailures) console.error(`  ✗ ${line}`);
  console.error('\n规则：L9 依赖路径前缀 + 相对 import 解析；集合为空时它永远不命中。');
  console.error('改目录名必须同批改 L9_MAIN_ROOTS / L9_ANALYSIS_ROOTS，并保留至少一条可解析的相对 import。');
  console.error('例外清单（L9_ALLOWED_TARGETS）里的文件也必须真实存在，否则例外会静默失效。');
  process.exit(1);
}

for (const r of Object.values(R)) if (r.hits.length) violations.push(r);

if (violations.length === 0) {
  console.log(
    `[layers] OK — ${Object.keys(R).length} 条分层规则全部通过（扫描 ${feFiles.length + rsFiles.length} 个文件；` +
      `L9 主窗 ${L9_MAIN_FILES.length} / 分析窗 ${L9_ANALYSIS_FILES.length} 个文件）`,
  );
  process.exit(0);
}

console.error('[layers] FAILED — 分层规则被破坏\n');
for (const r of violations) {
  console.error(`✗ ${r.id} ${r.desc}`);
  for (const hit of r.hits.slice(0, 12)) console.error(`    ${hit}`);
  if (r.hits.length > 12) console.error(`    … 另有 ${r.hits.length - 12} 处`);
}
console.error('\n规则全文见 docs/reviews/2026-10-18-ARCH-ASSESSMENT.md §3.4（L9 见 patina-structural-merge.md §1.1）');
process.exit(1);
