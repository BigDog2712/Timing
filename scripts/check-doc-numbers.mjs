#!/usr/bin/env node
/**
 * Timing — 文档数字一致性（`AGENTS.md` / `README.md` 里那些会过期的手写数字）
 * -----------------------------------------------------------------------------
 * ## 为什么需要它
 *
 * 本仓大量「硬事实」同时存在于两处：源码里算得出来，文档里手写一遍。
 * 二者之间没有任何约束，而**漂移的症状是「新人和代理照着过期数字做方案」**——
 * 不会报错、不会变红，只会在几天后表现为「按文档写的做完了，但不对」。
 *
 * 2026-11-16 实测到的四例（都在 `AGENTS.md` / `README.md` 抬头几百字内）：
 *
 *   · `AGENTS.md` 写「共七支，当前 schema v7」——实际 14 个版本、schema v14；
 *   · `AGENTS.md` 写「宿主命令 83 条」——实际 94；
 *   · `AGENTS.md` 写「当前 18 个」错误码——实际 19；
 *   · `README.md` 写「当前主线 0.12.2」——实际 0.12.3。
 *
 * ## 判据（六个数字 × 七个锚点）
 *
 * 数字全部**从源码现算**，一个都不写死；文档侧只提供「数字住在哪个句子里」的正则。
 * 这是刻意的：写死数字的门禁每次改代码都要同批改门禁，而「改代码忘了改门禁」
 * 正是它要防的事。
 *
 * ## 自我防伪
 *
 * 每条锚点都打印**解析到的实际值**。任一正则失配 ⇒ 直接失败并点名该锚点，
 * 提示「文档措辞变了，先修本脚本的正则」——措辞改写让规则静默不再命中，
 * 是本脚本唯一会「绿着空转」的形态；把它变成显式失败，就没有这个盲区了。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ------------------------------------------------------------------ 现算 */

/** 迁移版本的 `distinct` 前缀（`0012_v01250_usage_span.sql` 与它的 `_guard` 同属一支）。 */
function migrationVersions() {
  const files = readdirSync(join(root, 'src-tauri/src/migrations')).filter((f) => f.endsWith('.sql'));
  const versions = new Set();
  for (const file of files) {
    const m = /^(\d{4})_/.exec(file);
    if (!m) throw new Error(`迁移文件名不符合 00NN_ 前缀：${file}`);
    versions.add(Number(m[1]));
  }
  const sorted = [...versions].sort((a, b) => a - b);
  /* 防空转：一支都解析不出来时，下面所有断言都会「恰好相等」，必须当场失败。 */
  if (sorted.length === 0) throw new Error('迁移目录里没有解析到任何版本号');
  return { count: sorted.length, head: sorted[sorted.length - 1] };
}

/** `ipc_commands.rs` 的 `generate_handler![...]` 里宿主与活动窗各自的命令条数。 */
function commandCounts() {
  const src = read('src-tauri/src/ipc_commands.rs');
  const start = src.indexOf('generate_handler![');
  if (start < 0) throw new Error('ipc_commands.rs 里找不到 generate_handler![...]');
  const body = src.slice(start, src.indexOf('];', start));
  let host = 0;
  let activity = 0;
  for (const m of body.matchAll(/crate::commands::([A-Za-z0-9_:]+)/g)) {
    /* `crate::commands::activity::<mod>::<fn>` 是活动窗（原 Patina）的命令；
       其余 `crate::commands::<mod>::<fn>` 是宿主。判据只看第二段是不是 `activity`。 */
    if (m[1].startsWith('activity::')) activity += 1;
    else host += 1;
  }
  if (host === 0 || activity === 0) {
    throw new Error(`命令解析出 0 条（host=${host} / activity=${activity}）：正则或文件结构变了`);
  }
  return { host, activity };
}

/** `error.rs::as_str` 的 match 臂数 = 错误码条数。 */
function errorCodeCount() {
  const src = read('src-tauri/src/error.rs');
  const fn = src.indexOf('pub const fn as_str');
  if (fn < 0) throw new Error('error.rs 里找不到 as_str');
  const body = src.slice(fn, src.indexOf('}\n    }', fn));
  const count = [...body.matchAll(/ErrorCode::[A-Za-z0-9]+\s*=>\s*"/g)].length;
  if (count === 0) throw new Error('as_str 里解析出 0 个错误码：正则或写法变了');
  return count;
}

function platformVersions() {
  const conf = JSON.parse(read('scripts/platform-versions.json'));
  const desktop = conf.desktop;
  const mobile = conf.mobile?.versionName;
  if (!desktop || !mobile) throw new Error('platform-versions.json 里缺 desktop 或 mobile.versionName');
  return { desktop, mobile };
}

/* -------------------------------------------------------------- 文档锚点 */

const failures = [];
/** 已核对的锚点数，用于防空转（0 个锚点不算通过）。 */
let checked = 0;

/**
 * 在 `file` 里找到唯一一处 /唯一的多处/ 该正则，断言它捕获到的数字等于 `expected`。
 *
 * `expect` 是「文档里这句话在承诺什么」，失败时原样打印——报错要能让不改代码的人
 * 看懂该改文档还是该改代码。
 */
function anchor(file, re, expected, expect) {
  const text = read(file);
  /* `matchAll` 要求带 `g`；调用处的正则多为「只该匹配一处」，不逐个加 g —— 在这里归一，
     免得某天有人漏写 g 就得到一个 TypeError 而不是一条判据。 */
  const global = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
  const hits = [...text.matchAll(global)];
  if (hits.length === 0) {
    failures.push(
      `[${file}] 正则失配：${re}\n    ⇒ 文档措辞被改写了，先修 scripts/check-doc-numbers.mjs 的正则`,
    );
    return;
  }
  for (const hit of hits) {
    const actual = hit[1];
    checked += 1;
    if (actual !== String(expected)) {
      failures.push(`[${file}] 文档写 ${actual}，源码是 ${expected} —— ${expect}`);
    }
  }
}

/* ------------------------------------------------------------------ 执行 */

const { count: migCount, head: migHead } = migrationVersions();
const { host, activity } = commandCounts();
const codes = errorCodeCount();
const { desktop, mobile } = platformVersions();

anchor('AGENTS.md', /共 \*\*(\d+)\*\* 个版本/, migCount, '迁移支数应等于 migrations/ 下的版本数');
anchor('AGENTS.md', /schema \*\*v(\d+)\*\*/, migHead, 'schema 版本应等于最高迁移号');
anchor('AGENTS.md', /宿主命令 \*\*(\d+)\*\* 条/, host, '宿主命令条数应等于 generate_handler 里的宿主臂');
anchor('AGENTS.md', /Patina \*\*(\d+)\*\* 条/, activity, '活动窗命令条数应等于 generate_handler 里的 activity 臂');
anchor('AGENTS.md', /当前 \*\*(\d+)\*\* 个；\*\*加码与下架/, codes, '错误码条数应等于 as_str 的 match 臂数');

/* README 里「当前主线」出现两处（历史上的两个早期版本那段 + 尚未出包那段），两处都要对。 */
anchor('README.md', /当前主线 (\d+\.\d+\.\d+)/g, desktop, 'README 的「当前主线」应等于 platform-versions.desktop');
anchor('README.md', /桌面 \*\*(\d+\.\d+\.\d+)\*\*，Tauri 移动端 \*\*(\d+\.\d+\.\d+)\*\*/, desktop, '桌面版号');

/* `Tauri 移动端 **X**` 是上面那条正则的第 2 个捕获组，单独再核一次移动端。 */
{
  const text = read('README.md');
  const hit = /桌面 \*\*\d+\.\d+\.\d+\*\*，Tauri 移动端 \*\*(\d+\.\d+\.\d+)\*\*/.exec(text);
  checked += 1;
  if (!hit) {
    failures.push('[README.md] 移动端版号正则失配：先修本脚本的正则');
  } else if (hit[1] !== mobile) {
    failures.push(`[README.md] 文档写移动端 ${hit[1]}，源码是 ${mobile} —— 应等于 platform-versions.mobile.versionName`);
  }
}

/* ------------------------------------------------------------------ 结论 */

if (failures.length > 0) {
  console.error(`[doc-numbers] FAILED — ${failures.length} 处数字与源码不符：`);
  for (const line of failures) console.error(`  · ${line}`);
  process.exit(1);
}

/* 防空转：锚点数为 0 = 一条都没核，绿也没有意义。 */
if (checked === 0) {
  console.error('[doc-numbers] FAILED — 一个锚点都没核到（正则全失配）');
  process.exit(1);
}

console.log(
  `[doc-numbers] OK — 核对 ${checked} 个锚点：迁移 ${migCount} 支 / schema v${migHead} / ` +
    `命令 宿主 ${host} + 活动窗 ${activity} / 错误码 ${codes} / 桌面 ${desktop} / 移动端 ${mobile}`,
);
