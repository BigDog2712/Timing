#!/usr/bin/env node
/**
 * Timing — 品牌残留门禁（PRD P2-3 / R7 的机械执行）
 * -----------------------------------------------------------------------------
 * 判据：**两条扫描**，都大小写不敏感。
 *
 *   ① 历史旧名 `tickbar` —— **全仓**扫（除白名单）。
 *   ② 上游旧名 `patina` —— 只扫「用户可见文案表」（见 NARROW_SCOPES）。
 *
 * ## 为什么必须两条、且范围不同（0.12.0 的教训）
 *
 * 0.12.0 把上游 Patina 融进宿主 Timing，产品名统一为 Timing。上一轮只改了 10 处就报了
 * 完成，而本脚本当时只有 ①（`PATTERN = 'tickbar'`，v0.5.0 的旧名）—— **它从来没扫过
 * `Patina`**，于是「门禁绿」对这件事根本没有任何证明力，实际还剩约 90 条 × 4 语种。
 * 教训：门禁的判据必须与「本次改名改的是什么」对齐，否则绿灯是假的（PRD §3.3.1 纪律二）。
 *
 * 但下游不能照抄 ① 的做法。全仓有 692 处合法的小写 `patina`：文件路径、
 * 模块名、`patina.db`、`open_patina_window`、`patina_coverage` feature、注释……
 * 它们是**技术标识符**，改名会拆掉数据库定位、迁移与上游 diff 能力（见 docs/refactor/
 * patina-structural-merge.md）。把 `patina` 塞进 ① 的 PATTERN 只会得到一条永久红的门禁，
 * 而永久红 = 被忽略 = 等于没有门禁。
 *
 * 所以纪律是：**`tickbar` 全仓扫（它在代码里已无合法用途）；`patina` 只扫文案表
 * （在文案表里它必然是用户可见的品牌名，没有第二种解释）。** 新增 Scope 前先确认这条。
 *
 * ## 为什么必须 `git grep -in`
 *
 * 品牌有大小写两种写法且两处相反（`src-tauri/gen/android` 小写 `Theme.timing`；
 * 归档 `android-app` 大写 `Theme.TickBar`）。区分大小写的扫描会**静默漏过大写
 * `TickBar`**——门禁绿、保护消失，比不写这条规则更危险（PRD §3.3.1 纪律二）。
 * `INPUT_CASE_FLAG` 见下方常量：`-i` 是本脚本的核心判据，删掉即等于关掉一半规则。
 * ② 同理：`Patina` 在文案里既是句首大写也是句中大写，小写形态出现在网址里，一律要抓。
 *
 * ## 白名单（scripts/brand-allowlist.txt）
 *
 * 两种条目：
 *   - `路径`              → 整个文件豁免（历史留档 / 改名计划本身）
 *   - `路径 :: 子串`      → 该文件里**含此子串的行**豁免（历史名称引用，如
 *                          `com.tickbar.app` 在迁移章节里是「旧值」，必须留着）
 * 路径支持 `*`（单段）与 `**`（任意段）通配。两条扫描共用同一份白名单。
 *
 * ## 归档目录不许静默跳过
 *
 * `android-app/` 是归档件、本轮零改动（PRD T01.6），所以它的残留是「已知且有意」的。
 * 但**静默跳过 = 自欺**：将来没人知道这里有残留、残留多少。故必须打印
 * 「已跳过归档目录 android-app：N 处」，N 随残留增减而变——这是「不静默」的可测判据。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* 大小写不敏感（PRD §3.3.1 纪律二）：大写 `TickBar` 与小写 `tickbar` 都要抓。 */
const INPUT_CASE_FLAG = '-i';
/* ① 历史旧名：全仓扫。 */
const PATTERN = 'tickbar';
/* ② 上游旧名：只扫文案表。**不要**把它并进 PATTERN——理由见文件头。
 * 范围就这两处：唯一的两张「用户可见文案表」（前端 i18n 资源数组 + Rust 原生文案表）。 */
const NARROW_PATTERN = 'patina';
const NARROW_SCOPES = [
  'src/windows/patina/shared/i18n/generated/',
  'src-tauri/src/models/insight/localization/generated.rs',
];
const ARCHIVE_DIRS = ['android-app/'];

const allowPath = join(root, 'scripts/brand-allowlist.txt');
if (!existsSync(allowPath)) {
  console.error('[brand] FAILED — 找不到 scripts/brand-allowlist.txt');
  process.exit(1);
}

/** 白名单条目：{ glob, needle|null }。`needle` 非空时只豁免含该子串的行。 */
function loadAllowlist() {
  const lines = readFileSync(allowPath, 'utf8').split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [pathPart, needle] = line.split('::').map((s) => s.trim());
      return { glob: pathPart, needle: needle || null };
    });
}

/** glob → RegExp：`**` 任意层（含零层），`*` 单层内任意字符。 */
function globToRe(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp(`^${body}$`);
}

/** 跑 `git grep`，返回 [{ file, line, text }]。无命中返回空数组。 */
function scan(pattern, pathspecs = []) {
  let out = '';
  try {
    /* -n 给行号；-I 跳过二进制；-i 大小写不敏感（见文件头）；--untracked 连未跟踪文件一起扫。
       为什么必须 --untracked：只扫已跟踪文件时，**新建**的文件带着旧品牌也能让门禁变绿
       （`git grep` 默认只看索引里的文件）—— 而新建文件正是最容易漏的那类残留。
       gitignore 排除的目录（dist / target / node_modules）仍不会被扫到。
       core.quotepath=false：中文文件名不能被转义成 "\345\275..."，否则白名单匹配不上。
       pathspecs 之后必须先给 `--`，否则以 `-` 开头的路径会被当成选项。 */
    out = execFileSync(
      'git',
      [
        '-c', 'core.quotepath=false', 'grep', '--untracked', INPUT_CASE_FLAG, '-n', '-I',
        pattern,
        ...(pathspecs.length ? ['--', ...pathspecs] : []),
      ],
      {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    /* git grep 无命中时退出码 1 —— 这是成功路径，不是错误。 */
    if (err.status === 1) return [];
    console.error(`[brand] FAILED — git grep 执行失败（退出码 ${err.status ?? '?'}）`);
    process.exit(1);
  }
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((row) => {
      const first = row.indexOf(':');
      const second = row.indexOf(':', first + 1);
      return {
        file: row.slice(0, first),
        line: row.slice(first + 1, second),
        text: row.slice(second + 1),
      };
    });
}

/**
 * 按白名单把命中分流：归档 / 整文件豁免 / 行级豁免 / 违规。
 *
 * 两条扫描**共用这一份分流逻辑**：豁免规则一旦分叉，就会有一侧被忘记更新，
 * 于是「这条早就加过白名单了」在某条判据上悄悄不生效。
 */
function classify(hits) {
  const archived = new Map();
  const allowedFiles = new Map();
  const allowedLines = [];
  const violations = [];

  for (const hit of hits) {
    const archiveDir = ARCHIVE_DIRS.find((dir) => hit.file.startsWith(dir));
    if (archiveDir) {
      archived.set(archiveDir, (archived.get(archiveDir) ?? 0) + 1);
      continue;
    }
    const whole = allowlist.find((e) => !e.needle && globToRe(e.glob).test(hit.file));
    if (whole) {
      allowedFiles.set(hit.file, (allowedFiles.get(hit.file) ?? 0) + 1);
      continue;
    }
    const byLine = allowlist.some(
      (e) => e.needle && globToRe(e.glob).test(hit.file) && hit.text.includes(e.needle),
    );
    if (byLine) {
      allowedLines.push(hit);
      continue;
    }
    violations.push(hit);
  }
  return { archived, allowedFiles, allowedLines, violations };
}

const allowlist = loadAllowlist();

/* ① 全仓旧名 tickbar */
const hits = scan(PATTERN);
const { archived, allowedFiles, allowedLines, violations } = classify(hits);

/* ② 文案表旧名 patina（范围写死在 NARROW_SCOPES） */
const narrowHits = scan(NARROW_PATTERN, NARROW_SCOPES);
const narrow = classify(narrowHits);

/* 归档目录必须显式报数：静默跳过等于把「这里还有残留」这件事藏起来。 */
for (const dir of ARCHIVE_DIRS) {
  const n = archived.get(dir) ?? 0;
  console.log(`[brand] 已跳过归档目录 ${dir.replace(/\/$/, '')}：${n} 处（归档件零改动，见 PRD T01.6）`);
}

const summary =
  `扫描命中 ${hits.length} 处；白名单豁免 ${allowedFiles.size} 个文件 / ${allowedLines.length} 行；` +
  `违规 ${violations.length} 处`;
/* 窄扫描必须**独立报数**：它覆盖的正是全仓扫描不敢覆盖的那半个判据，混进总账就看不见了。
 * 「命中 N 处」与「豁免 M 行」都要打——否则「豁免 1 行、残留 0」和「真的干净」长得一模一样。 */
const narrowSummary =
  `窄扫描（文案表 ${NARROW_PATTERN} · ${NARROW_SCOPES.length} 个范围）命中 ${narrowHits.length} 处；` +
  `白名单豁免 ${narrow.allowedFiles.size} 个文件 / ${narrow.allowedLines.length} 行；` +
  `残留 ${narrow.violations.length} 处`;

if (violations.length === 0 && narrow.violations.length === 0) {
  console.log(`[brand] OK — ${summary}`);
  console.log(`[brand] OK — ${narrowSummary}`);
  process.exit(0);
}

console.error(`[brand] FAILED — ${summary}`);
console.error(`[brand] FAILED — ${narrowSummary}\n`);
for (const v of [...violations, ...narrow.violations]) {
  const text = v.text.length > 120 ? `${v.text.slice(0, 120)}…` : v.text;
  console.error(`✗ ${v.file}:${v.line}  ${text.trim()}`);
}
console.error('\n规则：品牌已统一为 Timing，残留只允许出现在 scripts/brand-allowlist.txt 里。');
console.error('新增白名单条目必须写明理由（注释行），不要用白名单盖住真实回归。');
process.exit(1);
