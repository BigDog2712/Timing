#!/usr/bin/env node
/**
 * Timing — 分层门禁（把架构规则变成 grep，而不是 code review 的口头约定）
 * -----------------------------------------------------------------------------
 * 规则来自 `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` §3.4（R1~R6/R10）：
 *
 *   L1 组件不得触碰传输层：`ipc.` / `invoke(` 在 src/components 下 0 命中
 *   L2 状态容器不得触碰传输层：同上，src/stores 下 0 命中
 *   L3 窗口 API 只能经 `src/lib/window.ts`：全仓只有它 import `@tauri-apps/api/window`
 *   L4 Rust `infra` 不得依赖 `services`（解环，见 ADR-016）
 *   L5 Rust `commands` 不得直接依赖 `repositories`（必须经 service）
 *   L6 Rust 全域不得出现 `eprintln!`（结构化日志，见 platform/log.rs）
 *      —— vendored 子树（src/app、src/features、src/platform、src/shared，
 *         以及后端 5 个 `src-tauri/src/<层>/insight/`）与 L3 同口径豁免，见 VENDORED
 *   L7 编译期平台常量 `__TIMING_MOBILE__` 只允许出现在 `src/lib/platform.ts`
 *   L8 业务写入信号 `dirty::mark(` 只允许出现在 `src-tauri/src/commands/`
 *      （`jobs/` 与 `services/` 下 0 命中；见下方 L8 哨兵）
 *
 * 每一条都是「改坏了 CI 就红」的判据，而不是「建议」。
 *
 * ## L7 / L8 的哨兵（防「绿着空转」）
 *
 * L7 / L8 都是**按符号名 grep** 的规则：符号一改名而本脚本没跟着改，规则就会去扫
 * 一个根本不存在的符号，于是打印「N 条规则全部通过」，而保护已经消失（PRD R7 警告
 * 的最隐蔽回归）。所以末尾有哨兵：L7 要求该常量同时出现在「声明处 + 两处 define」；
 * L8 要求 `dirty.rs` 里真的存在 `pub fn mark(`。少一处即红色退出，逼人一起改。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
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

/* vendored 子树口径（V0.12.0 融合 Patina）
 *
 * 前端那半（`src/app/**`、`src/features/**`、`src/platform/**`、`src/shared/**`）与后端
 * 5 个 `insight/` 命名空间（`app/insight`、`commands/insight`、`infra/insight`、
 * `models/insight`、`services/insight`）都是原样并入的第三方源码（Patina 1.10.0，
 * MIT）。它按自己的分层组织代码，不认宿主的 L3（窗口 API 单一入口）与 L6（禁 eprintln!）。
 * 改它等于放弃「diff 上游、按需同步」——所以**只对这两条规则**豁免，其余照扫。
 *
 * 代价写在明处：Patina 那 154 处 `eprintln!` 在打包版里没有控制台可看，
 * 它的诊断只活在 dev 终端。要接进宿主日志需要逐处判级别（info/warn/error），
 * 属「按需同步上游」时一并做的事，不在这里机械替换。 */
/* [0.12.0 T02] 后端 `src-tauri/src/patina/` 已按层归一（见
 * docs/refactor/patina-structural-merge.md §2.2），前缀换成 5 个 `insight/` 新根；
 * 前端那 4 个根由 T01 定下，一字未动。 */
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

const violations = [];
const rule = (id, desc) => ({ id, desc, hits: [] });
const R = {
  L1: rule('L1', '组件（src/components）不得出现 ipc. / invoke('),
  L2: rule('L2', '状态容器（src/stores）不得出现 ipc. / invoke('),
  L3: rule('L3', '@tauri-apps/api/window 只允许被 src/lib/window.ts 引用'),
  L4: rule('L4', 'Rust infra 不得 use crate::services'),
  L5: rule('L5', 'Rust commands 不得 use crate::repositories'),
  L6: rule('L6', 'Rust 不得使用 eprintln!（用 crate::log_*!）'),
  L7: rule('L7', `编译期平台常量 ${PLATFORM_SYMBOL} 只允许出现在 src/lib/platform.ts`),
  L8: rule('L8', '业务写入信号 dirty::mark( 只允许出现在 src-tauri/src/commands/'),
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
scan(
  feFiles,
  /@tauri-apps\/api\/window/,
  R.L3,
  (rel) => rel === 'src/lib/window.ts' || isVendored(rel),
);

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
scan(rsFiles, /\beprintln!\(/, R.L6, isVendored);

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
