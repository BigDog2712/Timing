#!/usr/bin/env node
/**
 * Timing — 品牌残留门禁（PRD P2-3 / R7 的机械执行）
 * -----------------------------------------------------------------------------
 * 判据：全仓除白名单外，不得再出现 `tickbar`（**大小写不敏感**）。
 *
 * ## 为什么必须 `git grep -in`
 *
 * 品牌有大小写两种写法且两处相反（`src-tauri/gen/android` 小写 `Theme.timing`；
 * 归档 `android-app` 大写 `Theme.TickBar`）。区分大小写的扫描会**静默漏过大写
 * `TickBar`**——门禁绿、保护消失，比不写这条规则更危险（PRD §3.3.1 纪律二）。
 * `INPUT_CASE_FLAG` 见下方常量：`-i` 是本脚本的核心判据，删掉即等于关掉一半规则。
 *
 * ## 白名单（scripts/brand-allowlist.txt）
 *
 * 两种条目：
 *   - `路径`              → 整个文件豁免（历史留档 / 改名计划本身）
 *   - `路径 :: 子串`      → 该文件里**含此子串的行**豁免（历史名称引用，如
 *                          `com.tickbar.app` 在迁移章节里是「旧值」，必须留着）
 * 路径支持 `*`（单段）与 `**`（任意段）通配。
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
const PATTERN = 'tickbar';
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
function scan() {
  let out = '';
  try {
    /* -n 给行号；-I 跳过二进制；-i 大小写不敏感（见文件头）；--untracked 连未跟踪文件一起扫。
       为什么必须 --untracked：只扫已跟踪文件时，**新建**的文件带着旧品牌也能让门禁变绿
       （`git grep` 默认只看索引里的文件）—— 而新建文件正是最容易漏的那类残留。
       gitignore 排除的目录（dist / target / node_modules）仍不会被扫到。
       core.quotepath=false：中文文件名不能被转义成 "\345\275..."，否则白名单匹配不上。 */
    out = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'grep', '--untracked', INPUT_CASE_FLAG, '-n', '-I', PATTERN],
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

const allowlist = loadAllowlist();
const hits = scan();

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

/* 归档目录必须显式报数：静默跳过等于把「这里还有残留」这件事藏起来。 */
for (const dir of ARCHIVE_DIRS) {
  const n = archived.get(dir) ?? 0;
  console.log(`[brand] 已跳过归档目录 ${dir.replace(/\/$/, '')}：${n} 处（归档件零改动，见 PRD T01.6）`);
}

const summary =
  `扫描命中 ${hits.length} 处；白名单豁免 ${allowedFiles.size} 个文件 / ${allowedLines.length} 行；` +
  `违规 ${violations.length} 处`;

if (violations.length === 0) {
  console.log(`[brand] OK — ${summary}`);
  process.exit(0);
}

console.error(`[brand] FAILED — ${summary}\n`);
for (const v of violations) {
  const text = v.text.length > 120 ? `${v.text.slice(0, 120)}…` : v.text;
  console.error(`✗ ${v.file}:${v.line}  ${text.trim()}`);
}
console.error('\n规则：品牌已统一为 Timing，残留只允许出现在 scripts/brand-allowlist.txt 里。');
console.error('新增白名单条目必须写明理由（注释行），不要用白名单盖住真实回归。');
process.exit(1);
