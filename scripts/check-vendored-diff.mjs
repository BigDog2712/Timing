#!/usr/bin/env node
/**
 * Timing — vendored 差异门禁（Patina 子树「只能按登记改」）
 * -----------------------------------------------------------------------------
 * 前端那半（`src/app/**`、`src/features/**`、`src/platform/**`、`src/shared/**`）与
 * 后端 5 个 `insight/` 命名空间（`app` / `commands` / `infra` / `models` / `services`）
 * 都是**源码级并入**的第三方代码
 * （Patina，MIT），不是我们写的。它的存在价值有一半在「随时能 diff 上游、按需同步」——
 * 而这个能力会被**无声的顺手改动**一点点吃掉：调个颜色、加个 Console、把 300 行拆两半，
 * 每一处都很合理，攒上十轮之后上游发了新版，合并时全是逐行冲突，谁也说不清哪几行是
 * 我们的意思。
 *
 * 所以这里管一件事：**改动必须登记**。没登记的改动直接报红，登记的成本只是往
 * `scripts/vendored-allowlist.json` 写一行理由——这个成本是故意的。
 *
 * ## 这条门禁能抓什么、抓不到什么（别过度承诺）
 *
 * 判据只有一条：**逐文件哈希与基线不同**。由基线里有没有这个文件，分成两半：
 *
 *   · `modified` / `deleted`（基线里有哈希的文件）—— 内容变化、文件消失都能抓到，
 *     这是账本的主力；
 *   · `added`（基线里没有、我们新写的文件）—— 只能抓到「出现了」这一件事。
 *     **登记之后它的内容再怎么改都抓不到**，因为基线里从来没有它的哈希。
 *     把新文件加进 allowlist，等于对它永久免检 —— 所以新文件不该靠 allowlist 入职。
 *
 * ## 批次规则（比「逐条登记」更省、也更准）
 *
 * 每一批结构改动（T01/T02/… 这种整层搬迁或机械改写）**不是**往 allowlist 里堆几百条
 * 同理由条目，而是：批次结束后，按**归一态**重新锚定受影响的根（`--refresh <批次 sha>`，
 * 或对子根做等价的重算），并在基线的 `_reanchor` 里追加一步：
 * `step / scope / changed 数量 / why / commit sha`。
 *
 * 这样门禁的语义是「**不被任何已记录批次覆盖的改动就报红**」：账本记录的是「哪一批、
 * 为什么、动了多大范围」，而不是「每个文件一行理由」。allowlist 只留给**批次之外的
 * 临时改动**（比如某次单独修一个上游 bug），那才是需要逐条写理由的东西。
 *
 * ### 收口小批判据：≤10 个文件走 allowlist，>10 或纯机械批量才重锚
 *
 * 批次规则按「文件数」分档，避免把一次十来行的收口也洗成「一个批次」：
 *
 *   · **≤10 个文件**：逐条写进 `scripts/vendored-allowlist.json`（path + change + reason）。
 *     每个文件改了什么、为什么改，信息量比一条 `_reanchor` 摘要高——这档不该重锚。
 *   · **>10 个文件或纯机械批量**（整层搬迁、全仓改名、格式化）：用 `--refresh <sha>`
 *     重锚，并在 `_reanchor` 里写清 step / scope / changed / why / sha。
 *
 * 本仓的 T03 收口批（事件常量化补齐监听侧与局部 const，10 个文件）按前档走 allowlist。
 *
 * 代价要说清：重锚之后，该批次里的改动**不再**逐个可查；能查的是「批次粒度」的动机与
 * 范围。所以 `_reanchor` 的 `scope` / `why` 必须写实，`--upstream` 仍如实报「与上游的
 * 总分歧」，两者互补——前者管「我们自己有没有乱动」，后者管「离上游漂了多远」。
 *
 * 基线的取法（重要）：
 *   基线 = **融合完成态**（前端 commit 7bc7bd7）与 **归一态**（后端 commit 9a7772f）
 *   的哈希快照，不是上游原样。`source` 因此拆成 frontend / backend 两个锚点：
 *   T01 只把前端路径剥掉 `patina/` 这一层（内容哈希不变），T02 才把后端铺进宿主六层；
 *   此后 T02/T03 的机械改写按 `_reanchor` 整批重锚（最新哈希对应 4ef9e1c），
 *   `_reanchor` 本身就是「哪一批、为什么、动了多大范围」的账。
 *   原因：并入时做过**机械改写**——`crate::` → `crate::patina::`（后来归一又改回
 *   `crate::`）、内联 `#[cfg(test)] mod tests` 拆成 `*_mod_tests.rs`（35 个文件）、
 *   命令模块补 `_cmd` 后缀（17 个文件）、模块树上移。
 *   这些是「搬家」不是「改需求」，用逐文件白名单去表达只会得到 250 条噪音，
 *   而真正要盯的是**搬家之后**谁又动了它。融合期的改动记在 `THIRD-PARTY-NOTICES.md`
 *   第 1–7 条（人读），不在这里重复一遍。
 *
 * 三个模式：
 *   node scripts/check-vendored-diff.mjs                  门禁（默认，供 npm run check）
 *   node scripts/check-vendored-diff.mjs --refresh <ref>  从 git ref 重建基线
 *   node scripts/check-vendored-diff.mjs --upstream <dir> 出「与上游差多少」的报告
 *
 * `--upstream` 只报告不卡门：它需要上游副本（解压的 patina-main），属于**查账**动作，
 * 不是每次提交都要跑的事。报告里会把本地归一态**反推回上游坐标系**（`UPSTREAM_MAP`
 * + `TEXT_MAP`），否则前缀差异会把真正的改动淹掉。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* [0.12.0 T02] 前端 4 个根由 T01 定下；后端 `src-tauri/src/patina/` 已按层归一，
 * 换成 5 个 `insight/` 新根（docs/refactor/patina-structural-merge.md §2.2）。 */
const ROOTS = [
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
const BASELINE = join(root, 'scripts', 'vendored-baseline.json');
const ALLOWLIST = join(root, 'scripts', 'vendored-allowlist.json');
const HASH_LEN = 16; // 64 bit 足够区分「同一文件的两个版本」，全量 64 位会让清单膨胀三倍

/* 上游相对路径 → 本地相对路径（§6.2）。全部是「前缀 + 尾部原样」，无逐文件特例；
 * `extra` 是上游 `src/` 根下的 4 个例外：App.tsx / main.tsx / App.css 进 `src/app/`，
 * styles 进 `src/app/styles/`。顺序无关——反推时按 loc 长度从长到短匹配，
 * 保证 `src/app/styles/*` 不会被 `src/app` 那条先吃掉。 */
const UPSTREAM_MAP = [
  // 前端：4 个域目录是纯前缀剥离
  {
    up: 'src/app',
    loc: 'src/app',
    extra: [
      { up: 'src/App.tsx', loc: 'src/app/App.tsx' },
      { up: 'src/main.tsx', loc: 'src/app/main.tsx' },
      { up: 'src/App.css', loc: 'src/app/App.css' },
      { up: 'src/styles', loc: 'src/app/styles' },
    ],
  },
  { up: 'src/features', loc: 'src/features' },
  { up: 'src/platform', loc: 'src/platform' },
  { up: 'src/shared', loc: 'src/shared' },
  // 后端：6 条前缀映射（上游单层目录 → 本地 `<层>/insight/...`）
  { up: 'src-tauri/src/domain', loc: 'src-tauri/src/models/insight' },
  { up: 'src-tauri/src/platform', loc: 'src-tauri/src/infra/insight' },
  { up: 'src-tauri/src/data', loc: 'src-tauri/src/services/insight/data' },
  { up: 'src-tauri/src/engine', loc: 'src-tauri/src/services/insight/engine' },
  { up: 'src-tauri/src/app', loc: 'src-tauri/src/app/insight' },
  { up: 'src-tauri/src/commands', loc: 'src-tauri/src/commands/insight' },
];

/* 文本归一：本地归一态路径 → 上游路径。**单遍**替换，避免 A→B 之后又被 B→C 二次命中。 */
const TEXT_MAP = new Map([
  ['crate::services::insight::data::', 'crate::data::'],
  ['crate::models::insight::', 'crate::domain::'],
  ['crate::infra::insight::', 'crate::platform::'],
  ['crate::commands::insight::', 'crate::commands::'],
  ['crate::services::insight::engine::', 'crate::engine::'],
  ['crate::app::insight::', 'crate::app::'],
]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEXT_MAP_RE = new RegExp([...TEXT_MAP.keys()].map(escapeRe).join('|'), 'g');

/* N2 的 17 个 `_cmd` 后缀词表（与 §2 命名规范化同源）。归一为「单遍、词表精确匹配」：
 * 不做泛化 `_cmd` 剥离，避免把普通标识符（如 `xxx_cmd` 变量）也改掉。 */
const CMD_WORDS = [
  'activity_read_model',
  'backup',
  'diagnostics',
  'export',
  'import',
  'mini_window',
  'persistence_read',
  'persistence',
  'settings',
  'storage',
  'tool_notifications',
  'tools',
  'tracking',
  'update',
  'web_activity_analysis',
  'web_activity',
  'window',
];
const CMD_RE = new RegExp(`(?<![a-z0-9_])(${CMD_WORDS.map(escapeRe).join('|')})_cmd(?![a-z0-9_])`, 'g');

const toPosix = (p) => p.split(sep).join('/');
const digest = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);

/** 逐层列出 roots 下的文件名（相对仓库根、posix 分隔）。 */
function listFiles() {
  const out = [];
  for (const rel of ROOTS) {
    const base = join(root, rel);
    if (!existsSync(base)) continue;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.push(toPosix(relative(root, full)));
      }
    };
    walk(base);
  }
  return out.sort();
}

function hashWorkingTree(files) {
  const map = new Map();
  for (const rel of files) map.set(rel, digest(readFileSync(join(root, rel))));
  return map;
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of Object.keys(data)) if (key.startsWith('_')) delete data[key];
  return data;
}

// ---------------------------------------------------------------------------
// --refresh：从 git ref 取内容算哈希（不读工作树，否则「带病冻结」会悄悄把改动吸进基线）
// ---------------------------------------------------------------------------

function hashGitRef(ref) {
  const list = spawnSync('git', ['ls-tree', '-r', '--name-only', ref, '--', ...ROOTS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (list.status !== 0) {
    console.error(`[vendored] 读不到 ${ref} 的文件清单 —— ${(list.stderr || '').trim()}`);
    console.error('  常见原因：浅克隆 / ref 不存在 / 在一个不含该提交的分支上。');
    process.exit(1);
  }
  const paths = list.stdout.split('\n').filter(Boolean);
  if (paths.length === 0) {
    console.error(`[vendored] ${ref} 下没有 vendored 文件，拒绝把空清单写成基线。`);
    process.exit(1);
  }
  // `--batch` 吃的是对象名，不是仓库路径：必须写成 `<ref>:<path>`，否则 git 回
  // `<path> missing`（无内容），我们会得到一串「空文件」的哈希——而且完全不报错。
  const batch = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: paths.map((p) => `${ref}:${p}`).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (batch.status !== 0) {
    console.error(`[vendored] git cat-file 失败 —— ${(batch.stderr || '').trim()}`);
    process.exit(1);
  }
  const buf = batch.stdout;
  const files = {};
  let pos = 0;
  for (const expected of paths) {
    const nl = buf.indexOf(10, pos);
    const header = buf.toString('utf8', pos, nl).split(' ');
    const size = Number(header[2]);
    if (header[1] !== 'blob' || !Number.isFinite(size)) {
      console.error(`[vendored] 取不到 ${expected} 的内容（git 回：${header.join(' ')}）`);
      process.exit(1);
    }
    const start = nl + 1;
    files[toPosix(expected)] = digest(buf.subarray(start, start + size));
    pos = start + size + 1; // 内容后面跟一个换行
  }
  return files;
}

function refreshBaseline(ref) {
  if (!ref) {
    console.error('[vendored] --refresh 需要给出 git ref，例如：--refresh 7bc7bd7');
    process.exit(1);
  }
  const files = hashGitRef(ref);
  // 重建是唯一能把白名单「洗白」的动作：如果有人带着未登记的改动重建，那些改动就变成
  // 新基线的一部分，从此再也查不出来。至少要让人看见洗掉了几处。
  const old = loadJson(BASELINE, null);
  if (old?.files) {
    const drift = Object.keys(files).filter((rel) => old.files[rel] && old.files[rel] !== files[rel]);
    const gone = Object.keys(old.files).filter((rel) => !files[rel]);
    if (drift.length || gone.length) {
      console.error(
        `[vendored] 注意：这次重建会把 ${drift.length} 处改动 / ${gone.length} 处删除固化进基线 —— ` +
          '如果它们还没登记，重建之后就查不出来了。',
      );
    }
  }
  const payload = {
    _doc:
      'vendored 基线：Patina 归一后的逐文件哈希（前端 src/app、src/features、src/platform、src/shared，' +
      '后端 src-tauri/src/{app,commands,infra,models,services}/insight）。' +
      '不要手改 —— 用 node scripts/check-vendored-diff.mjs --refresh <ref> 重生成，' +
      '日常改动请登记到 scripts/vendored-allowlist.json。',
    source: {
      kind: 'git',
      // 一次 --refresh 只能取一个 ref，两侧同锚；常态维护的锚点是
      // 前端 7bc7bd7（融合完成态）、后端 9a7772f（归一态），见现有基线。
      frontend: { ref, note: '本次重建由同一 ref 计算（正常应为融合完成态 7bc7bd7）' },
      backend: { ref, note: '本次重建由同一 ref 计算（正常应为归一态 9a7772f，T03 重锚在 4ef9e1c）' },
      upstream: 'https://github.com/Ceceliaee/patina',
      note: '两侧 ref 分开锚定：T01 只改前端路径（内容哈希不变），T02 才铺平后端；机械改写批次见 _reanchor',
      pathMapping:
        '前端 src/{app,features,platform,shared} 原样、src/App.{tsx,css} 与 src/main.tsx 进 src/app/、' +
        'src/styles → src/app/styles/；后端 src-tauri/src/{domain,platform,data,engine,app,commands} → ' +
        '本地 models/infra/services/services/app/commands 下的 insight 命名空间。--upstream 按 UPSTREAM_MAP 反推。',
      generated: new Date().toISOString().slice(0, 10),
    },
    roots: ROOTS,
    files,
  };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[vendored] 基线已重建：${Object.keys(files).length} 个文件 ← ${ref}`);
}

// ---------------------------------------------------------------------------
// --upstream：与上游副本对账（只报告）
// ---------------------------------------------------------------------------

/**
 * 把本地**归一态**反推回上游坐标系，剩下的才算「我们真的改了」。
 *
 * 三处：① 模块路径（6 条 TEXT_MAP，本地 `crate::services::insight::data::` → 上游
 *    `crate::data::` 一类反向映射，单遍替换）；
 * ② 命令模块的 `_cmd` 后缀（N2 给 17 个模块加的，剥离后与上游同名）；
 * ③ 文件里的 `#[cfg(test)]` 段落——上游写在文件内联的 `mod tests { … }`，并入时拆成
 *    独立文件 `<name>_mod_tests.rs`，本地只剩一句 `#[cfg(test)] mod tests;`。
 *
 * ③ 的代价要说清：**测试代码不参与对账**。拆分时是「只搬不改」，但之后谁在
 * `*_mod_tests.rs` 里动了断言，这份报告不会告诉你——要看测试改动，直接 diff 那些文件。
 */
function normalize(text) {
  // 单遍：`replace` 不会对替换结果再次扫描，避免 A→B 之后再被 B→C 命中。
  const mapped = text.replace(TEXT_MAP_RE, (m) => TEXT_MAP.get(m));
  const out = mapped.replace(CMD_RE, '$1');
  const at = out.indexOf('#[cfg(test)]');
  return at === -1 ? out : out.slice(0, at);
}

const CMD_COMPACT = (s) => s.replace(CMD_RE, '$1');

/** 本地相对路径 → 上游坐标系键；null = 这条本地文件不在任何映射里（净新增）。 */
function toUpstreamKey(locRel) {
  for (const m of UPSTREAM_MAP) {
    for (const ex of m.extra || []) {
      if (locRel === ex.loc) return ex.up;
      if (locRel.startsWith(`${ex.loc}/`)) return `${ex.up}/${locRel.slice(ex.loc.length + 1)}`;
    }
  }
  for (const m of [...UPSTREAM_MAP].sort((a, b) => b.loc.length - a.loc.length)) {
    if (locRel.startsWith(`${m.loc}/`)) {
      return CMD_COMPACT(`${m.up}/${locRel.slice(m.loc.length + 1)}`);
    }
  }
  return null;
}

/** 递归列出 dir 下所有文件（绝对路径）。 */
function walkFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

function reportUpstream(dir) {
  const upBase = join(dir, 'src');
  if (!existsSync(upBase)) {
    console.error(`[upstream] 目录不存在或结构不符：${dir}`);
    process.exit(1);
  }

  // 上游文件：键 = 相对上游仓库根的 posix 路径（即 UPSTREAM_MAP 的 up 侧原样）
  const upstream = new Map(); // key -> abs
  for (const m of UPSTREAM_MAP) {
    const base = join(dir, m.up);
    if (!existsSync(base)) {
      console.error(`[upstream] 映射源不存在：${m.up}（解压目录是否完整？）`);
      process.exit(1);
    }
    for (const full of walkFiles(base)) upstream.set(toPosix(relative(dir, full)), full);
    for (const ex of m.extra || []) {
      const exact = join(dir, ex.up);
      if (!existsSync(exact)) continue;
      // extra 可能是一棵目录（src/styles）或单个文件（src/App.tsx），两种都要收
      if (statSync(exact).isDirectory()) {
        for (const full of walkFiles(exact)) upstream.set(toPosix(relative(dir, full)), full);
      } else {
        upstream.set(ex.up, exact);
      }
    }
  }

  // 本地文件：键 = 反推后的上游路径；null 记为「仅本地（无对应）」
  const local = []; // { rel, key, abs }
  for (const relRoot of ROOTS) {
    const base = join(root, relRoot);
    if (!existsSync(base)) continue;
    for (const full of walkFiles(base)) {
      const rel = toPosix(relative(root, full));
      local.push({ rel, key: toUpstreamKey(rel), abs: full });
    }
  }

  const stats = {
    FE: { same: 0, diff: [], onlyUp: [], onlyLoc: [] },
    BE: { same: 0, diff: [], onlyUp: [], onlyLoc: [] },
  };
  const sideOf = (key, rel) => ((key ?? rel).startsWith('src-tauri') ? 'BE' : 'FE');

  const localByKey = new Map();
  for (const f of local) if (f.key) localByKey.set(f.key, f);

  for (const [key, upAbs] of upstream) {
    const hit = localByKey.get(key);
    const side = stats[sideOf(key)];
    if (!hit) {
      side.onlyUp.push(key);
      continue;
    }
    const same = normalize(readFileSync(upAbs, 'utf8')) === normalize(readFileSync(hit.abs, 'utf8'));
    if (same) side.same++;
    else side.diff.push(key);
  }
  for (const f of local) {
    if (f.key && upstream.has(f.key)) continue;
    stats[sideOf(f.key, f.rel)].onlyLoc.push(f.key ?? f.rel);
  }

  console.log(`[upstream] 对账目录：${dir}`);
  let totalDiff = 0;
  let totalSame = 0;
  for (const [side, s] of Object.entries(stats)) {
    const label = side === 'FE' ? '前端' : '后端';
    const split = s.onlyLoc.filter((k) => k.endsWith('_mod_tests.rs'));
    const realOnlyLoc = s.onlyLoc.filter((k) => !k.endsWith('_mod_tests.rs'));
    totalDiff += s.diff.length;
    totalSame += s.same;
    console.log(
      `  ${label} 同 ${s.same} · 实质差异 ${s.diff.length} · 仅上游 ${s.onlyUp.length}` +
        ` · 仅本地 ${s.onlyLoc.length}（测试拆分 ${split.length}）`,
    );
    for (const k of s.diff.sort()) console.log(`    改 ${k}`);
    for (const k of s.onlyUp.sort()) console.log(`    删 ${k}`);
    for (const k of realOnlyLoc.sort()) console.log(`    增 ${k}`);
  }
  console.log(
    `[upstream] 结论：合计 同 ${totalSame} · 实质差异 ${totalDiff} —— 这些差值才是真正的分叉，` +
      '合并上游新版时会逐条冲突，改动前请先看清是否必要。',
  );
}

// ---------------------------------------------------------------------------
// 默认：门禁
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
};

const refreshRef = flag('--refresh');
if (refreshRef !== null) {
  refreshBaseline(refreshRef);
  process.exit(0);
}
const upstreamDir = flag('--upstream');
if (upstreamDir !== null) {
  reportUpstream(upstreamDir || 'D:/302-IDM/patina-main/patina-main');
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('[vendored] 缺基线文件 scripts/vendored-baseline.json');
  console.error('  先生成一次：node scripts/check-vendored-diff.mjs --refresh <融合完成态的 ref>');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const allowRaw = loadJson(ALLOWLIST, { entries: [] });
const allow = new Map((allowRaw.entries || []).map((e) => [e.path, e]));

const files = listFiles();
const actual = hashWorkingTree(files);
const known = baseline.files || {};

const changed = { modified: [], added: [], deleted: [] };
for (const [rel, hash] of Object.entries(known)) {
  if (!actual.has(rel)) changed.deleted.push(rel);
  else if (actual.get(rel) !== hash) changed.modified.push(rel);
}
for (const rel of actual.keys()) if (!(rel in known)) changed.added.push(rel);

/** 未登记的改动 = 报红；登记了但类型不符（比如写了 modified 实际是删除）也算错。 */
const unlisted = [];
for (const kind of ['modified', 'added', 'deleted']) {
  for (const rel of changed[kind]) {
    const entry = allow.get(rel);
    if (!entry) unlisted.push({ rel, kind, why: '未登记' });
    else if (entry.change !== kind) {
      unlisted.push({ rel, kind, why: `登记为 ${entry.change}，实际是 ${kind}` });
    } else if (!entry.reason) {
      unlisted.push({ rel, kind, why: '登记缺 reason' });
    }
  }
}

/* owner 必填是**整表**约束，不只管当前有差异的条目：一条没有认领人的登记等于没有登记，
 * 等它哪天真的漂移了，没人能回答「这是谁改的、还作不作数」。 */
const missingOwner = [...allow.values()].filter((e) => !e.owner || !String(e.owner).trim());

const stale = [...allow.keys()].filter(
  (rel) =>
    !['modified', 'added', 'deleted'].some(
      (kind) => changed[kind].includes(rel) && allow.get(rel).change === kind,
    ),
);

const total = Object.keys(known).length;
const src = baseline.source ?? {};
const sourceLabel =
  src.frontend || src.backend
    ? `FE ${src.frontend?.ref ?? '?'} / BE ${src.backend?.ref ?? '?'}`
    : (src.ref ?? '?');
const summary =
  `基线 ${sourceLabel} · ${total} 个文件 · ` +
  `改 ${changed.modified.length} / 增 ${changed.added.length} / 删 ${changed.deleted.length} · ` +
  `白名单 ${allow.size} 条`;

if (unlisted.length === 0 && missingOwner.length === 0) {
  console.log(`[vendored] OK — ${summary}`);
  if (stale.length) {
    console.log(`[vendored] 提示：以下白名单条目已与基线一致（改动被还原或基线已更新），可删除 —— ${stale.join(', ')}`);
  }
  process.exit(0);
}

console.error(`[vendored] FAILED — ${summary}\n`);
for (const item of unlisted) console.error(`✗ ${item.rel} — ${item.kind}，${item.why}`);
for (const item of missingOwner) {
  console.error(`✗ ${item.path} — 登记缺 owner（必填：谁认领这次改动）`);
}
console.error(
  '\n规则：src/app/** src/features/** src/platform/** src/shared/** 与后端 5 个 ' +
    'src-tauri/src/<层>/insight/** ' +
    '是 vendored 第三方源码，改动必须登记。\n' +
    '  登记处：scripts/vendored-allowlist.json —— { path, change: modified|added|deleted, reason, owner }，' +
    'owner 必填。\n' +
    '  只是解压产物 / 编辑器换行 / 构建缓存误入？直接还原，不要登记。',
);
process.exit(1);
