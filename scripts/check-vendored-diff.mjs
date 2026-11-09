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
 * 基线的取法（重要）：
 *   基线 = **融合完成态**（commit 7bc7bd7）的哈希快照，不是上游原样。
 *   原因：并入时做过一次**机械改写**——`crate::` → `crate::patina::`（220 个文件）、
 *   内联 `#[cfg(test)] mod tests` 拆成 `*_mod_tests.rs`（35 个文件）、模块树上移。
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
 * 不是每次提交都要跑的事。报告里会把 `crate::patina::` 归一回去，否则 220 个文件的
 * 机械改写会把真正的改动淹掉。
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
      'vendored 基线：Patina 子树（前端 src/app、src/features、src/platform、src/shared，' +
      '后端 src-tauri/src/{app,commands,infra,models,services}/insight）在归一态的逐文件哈希。' +
      '不要手改 —— 用 node scripts/check-vendored-diff.mjs --refresh <ref> 重生成，' +
      '日常改动请登记到 scripts/vendored-allowlist.json。',
    source: {
      kind: 'git',
      ref,
      upstream: 'https://github.com/Ceceliaee/patina',
      note: '融合完成态（含 crate::patina:: 路径改写与测试拆分），不是上游原样',
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
 * 把并入时做过的**机械改写**归一回去，剩下的才算「我们真的改了」。
 *
 * 两处：① `crate::` → `crate::patina::`（模块树上移带来的批量路径改写）；
 * ② 文件里的 `#[cfg(test)]` 段落——上游写在文件内联的 `mod tests { … }`，并入时拆成
 *    独立文件 `<name>_mod_tests.rs`，本地只剩一句 `#[cfg(test)] mod tests;`。
 *
 * ② 的代价要说清：**测试代码不参与对账**。拆分时是「只搬不改」，但之后谁在
 * `*_mod_tests.rs` 里动了断言，这份报告不会告诉你——要看测试改动，直接 diff 那些文件。
 * 归一后剩下的差异才是真分叉（当前实测 17 个 Rust 文件 + 4 个前端文件）。
 */
function normalize(text) {
  const out = text.replaceAll('crate::patina::', 'crate::');
  const at = out.indexOf('#[cfg(test)]');
  return at === -1 ? out : out.slice(0, at);
}

function reportUpstream(dir) {
  const pairs = [
    { label: '前端 src/', up: join(dir, 'src'), loc: join(root, 'src', 'patina') },
    { label: '后端 src/', up: join(dir, 'src-tauri', 'src'), loc: join(root, 'src-tauri', 'src', 'patina') },
  ];
  if (!existsSync(pairs[0].up)) {
    console.error(`[upstream] 目录不存在或结构不符：${dir}`);
    process.exit(1);
  }
  const collect = (base) => {
    const map = new Map();
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else {
          const rel = toPosix(relative(base, full));
          map.set(rel, normalize(readFileSync(full, 'utf8')));
        }
      }
    };
    walk(base);
    return map;
  };
  console.log(`[upstream] 对账目录：${dir}`);
  let real = 0;
  for (const { label, up, loc } of pairs) {
    const u = collect(up);
    const l = collect(loc);
    const same = [...u.keys()].filter((k) => l.has(k) && u.get(k) === l.get(k));
    const diff = [...u.keys()].filter((k) => l.has(k) && u.get(k) !== l.get(k));
    const onlyUp = [...u.keys()].filter((k) => !l.has(k));
    const onlyLoc = [...l.keys()].filter((k) => !u.has(k));
    const added = onlyLoc.filter((k) => k.endsWith('_mod_tests.rs'));
    real += diff.length;
    console.log(
      `  ${label} 同 ${same.length} · 实质差异 ${diff.length} · 仅上游 ${onlyUp.length}` +
        ` · 仅本地 ${onlyLoc.length}（测试拆分 ${added.length}）`,
    );
    for (const k of diff) console.log(`    改 ${k}`);
    for (const k of onlyUp) console.log(`    删 ${k}`);
    for (const k of onlyLoc) if (!added.includes(k)) console.log(`    增 ${k}`);
  }
  console.log(
    `[upstream] 结论：归一后仍有 ${real} 个文件与上游不同 —— 这些是真正的分叉，` +
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

const stale = [...allow.keys()].filter(
  (rel) =>
    !['modified', 'added', 'deleted'].some(
      (kind) => changed[kind].includes(rel) && allow.get(rel).change === kind,
    ),
);

const total = Object.keys(known).length;
const summary =
  `基线 ${baseline.source?.ref ?? '?'} · ${total} 个文件 · ` +
  `改 ${changed.modified.length} / 增 ${changed.added.length} / 删 ${changed.deleted.length} · ` +
  `白名单 ${allow.size} 条`;

if (unlisted.length === 0) {
  console.log(`[vendored] OK — ${summary}`);
  if (stale.length) {
    console.log(`[vendored] 提示：以下白名单条目已与基线一致（改动被还原或基线已更新），可删除 —— ${stale.join(', ')}`);
  }
  process.exit(0);
}

console.error(`[vendored] FAILED — ${summary}\n`);
for (const item of unlisted) console.error(`✗ ${item.rel} — ${item.kind}，${item.why}`);
console.error(
  '\n规则：src/app/** src/features/** src/platform/** src/shared/** 与后端 5 个 ' +
    'src-tauri/src/<层>/insight/** ' +
    '是 vendored 第三方源码，改动必须登记。\n' +
    '  登记处：scripts/vendored-allowlist.json —— { path, change: modified|added|deleted, reason, owner }\n' +
    '  只是解压产物 / 编辑器换行 / 构建缓存误入？直接还原，不要登记。',
);
process.exit(1);
