#!/usr/bin/env node
/**
 * Timing — 版本号一致性门禁（AGENTS.md：版本号同步）
 * -----------------------------------------------------------------------------
 * V0.11.33 起是**双轨**：桌面与手机各走各的号，真源在 `scripts/platform-versions.json`。
 *
 *   桌面 —— 下面六处必须同为 `desktop`。
 *   手机 —— `mobile` 自己一套，`android-apk.mjs` 直接读它，不再从 tauri.conf.json 派生。
 *           这里只校验「versionCode 与 versionName 同源」+「没有往回退」。
 *
 * 为什么回退也要挡：Android 不允许降级覆盖安装。手机上次装的是 11033，这次给 11032，
 * 用户看到的是「安装失败」而不是「版本旧了」——所以这条得由门禁拦，不能靠人记。
 *
 * 桌面六处（必须同为 `desktop`）：
 *   1. package.json                      version
 *   2. package-lock.json                 version + packages[""].version
 *   3. src-tauri/Cargo.toml              [package] version
 *   4. src-tauri/Cargo.lock              name = <crate> 那条的 version
 *   5. src-tauri/tauri.conf.json         version
 * 第七处（**冻结断言**，不参与「与桌面同版本」比对）：
 *   6. scripts/archived-versions.json    → 归档工程 app/build.gradle.kts 的
 *      versionName / versionCode 必须等于冻结值（归档工程永不追当前版本）
 *
 * 为什么 crate 名要动态读（P0-4 / PRD R10）：
 *   改成 `name = "timing"` 的那一刻，若本脚本仍硬编码 `tickbar`，门禁必红，
 *   于是「改名 PR」被迫同时改门禁脚本——正是要避免的耦合。这里从
 *   `src-tauri/Cargo.toml` 的 `[package] name` 读，改名就退化为纯数据变更。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 双轨版号的真源。读不到就 FAIL——不许静默退回「六处互相比」。 */
function platformVersions() {
  const raw = read('scripts/platform-versions.json');
  const json = JSON.parse(raw);
  return { desktop: json.desktop, mobile: json.mobile };
}

/**
 * `release/` 与 `release/archive/` 下已发出的安卓包版本号。
 *
 * 用它挡「版号往回写」：这两个目录里的文件名是出包脚本与手工归档留下的**事实**，
 * 比任何一份清单都可靠。
 */
function shippedMobile() {
  const out = [];
  for (const dir of ['release', join('release', 'archive')]) {
    let names = [];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue; // 目录还没建（首次出包前就是这么跑的）
    }
    for (const n of names) {
      const m = /^Timing-android-(\d+\.\d+\.\d+)-[^/]*\.apk$/.exec(n);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

/** 语义比较（只比三段数字）。返回 <0 表示 a 比 b 旧。 */
function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** 与 `android-apk.mjs` / tauri CLI 同一公式：major*1_000_000 + minor*1_000 + patch。 */
function versionCodeOf(name) {
  const [maj, min, pat] = String(name).split('.').map((n) => Number(n) || 0);
  return maj * 1_000_000 + min * 1_000 + pat;
}

/**
 * 安卓两条脚本都必须从 `platform-versions.json` 取手机版号。
 *
 * V0.11.33 分轨当天 `android-apk.mjs` 改对了、`android-sign.mjs` 漏了 —— APK 内部是
 * `0.11.33 / 11033`，文件名叫 `Timing-android-0.11.27-…apk`。**包没错、名字全错**，
 * 归档/校验和/安装说明一整套对不上，而且没有任何一处报错。
 * 判据只认**调用**不认注释：两个文件都会在说明里提到 `tauri.conf.json`（讲清楚为什么
 * 不能读它），所以用 `readFileSync(...tauri.conf.json` 匹配才不误伤。
 */
function androidScriptsUseMobileVersion() {
  const failures = [];
  for (const file of ['scripts/android-apk.mjs', 'scripts/android-sign.mjs']) {
    let src;
    try {
      src = read(file);
    } catch {
      failures.push(`${file}: 读不到（改名或删除后请同步本断言）`);
      continue;
    }
    if (!src.includes('platform-versions.json')) {
      failures.push(`${file}: 没有读 platform-versions.json —— 手机版号只在那里`);
    }
    if (/readFileSync\([^)]*tauri\.conf\.json/.test(src)) {
      failures.push(`${file}: 仍在从 tauri.conf.json 读号 → 拿到的是桌面号，包名/版本会错`);
    }
  }
  return failures;
}

function packageJson() {
  return JSON.parse(read('package.json')).version;
}

function packageLock() {
  const lock = JSON.parse(read('package-lock.json'));
  return { top: lock.version, root: lock.packages?.['']?.version };
}

/** `[package]` 段到下一个顶层 `[` 之间，避免读到 `[lib]` 或依赖段的同名键。 */
function packageSection() {
  const src = read('src-tauri/Cargo.toml');
  const start = src.indexOf('[package]');
  if (start < 0) return '';
  const rest = src.slice(start + '[package]'.length);
  const next = rest.search(/^\[/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Rust crate 名（`[package] name`）。解析不到即 FAIL——不静默跳过。 */
function crateName() {
  const m = packageSection().match(/^name\s*=\s*"([^"]+)"/m);
  return m?.[1];
}

function cargoToml() {
  const m = packageSection().match(/^version\s*=\s*"([^"]+)"/m);
  return m?.[1];
}

function cargoLock(crate) {
  if (!crate) return undefined;
  const src = read('src-tauri/Cargo.lock');
  /* 只取本项目 crate 的 package 段：用正则**转义** crate 名，
     别指望 crate 名永远不含 `-` 之外的元字符（`-` 在正则里也只是普通字符）。 */
  const nameRe = new RegExp(`^name\\s*=\\s*"${escapeRe(crate)}"\\s*$`, 'm');
  const blocks = src.split('[[package]]');
  for (const b of blocks) {
    if (nameRe.test(b)) {
      const m = b.match(/^version\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    }
  }
  return undefined;
}

function tauriConf() {
  return JSON.parse(read('src-tauri/tauri.conf.json')).version;
}

/** 归档工程：断言冻结值未被误动（与桌面版本无关）。 */
function archivedEntries() {
  let manifest;
  try {
    manifest = JSON.parse(read('scripts/archived-versions.json'));
  } catch (err) {
    return { failures: [`scripts/archived-versions.json 读不到或不是合法 JSON：${err.message}`], rows: [] };
  }
  const failures = [];
  const rows = [];
  for (const item of manifest.archived ?? []) {
    let src;
    try {
      src = read(item.gradleFile);
    } catch {
      failures.push(`${item.id}: 找不到 ${item.gradleFile}（被删了就同步删本条目）`);
      continue;
    }
    const vn = src.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
    const vc = Number(src.match(/versionCode\s*=\s*(\d+)/)?.[1]);
    rows.push(`${item.id}: versionName=${vn ?? '（未解析到）'} versionCode=${Number.isNaN(vc) ? '（未解析到）' : vc}`);
    if (vn !== item.versionName) {
      failures.push(`${item.id}: versionName 应为冻结值 ${item.versionName}，实为 ${vn ?? '（未解析到）'}`);
    }
    if (vc !== item.versionCode) {
      failures.push(`${item.id}: versionCode 应为冻结值 ${item.versionCode}，实为 ${Number.isNaN(vc) ? '（未解析到）' : vc}`);
    }
  }
  return { failures, rows };
}

const crate = crateName();
const lock = packageLock();
const platform = platformVersions();

const entries = [
  ['package.json', packageJson()],
  ['package-lock.json (version)', lock.top],
  ['package-lock.json (packages[""])', lock.root],
  ['src-tauri/Cargo.toml', cargoToml()],
  [`src-tauri/Cargo.lock (${crate ?? 'crate 名未解析'})`, cargoLock(crate)],
  ['src-tauri/tauri.conf.json', tauriConf()],
];

const missing = entries.filter(([, v]) => !v);
const archive = archivedEntries();

const fail = (title, lines) => {
  console.error(`[version] FAILED — ${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
};

/* 真源读不出来时**立刻停**：下面所有比对都以它为基准，缺了它就会退化成
   「六处互相比」——那正是双轨要摆脱的旧口径，静默退回比红更糟。 */
if (!platform.desktop) {
  fail('scripts/platform-versions.json 里读不到 desktop', [
    '该文件是双轨版号的单一真源（V0.11.33 起）。',
    '桌面六处与安卓包号都以它为基准，没有它就无法判断谁该是谁。',
  ]);
}

if (!crate) {
  /* 解析不到 crate 名时**不许**继续：`cargoLock(crate)` 会静默返回 undefined，
     下面会退化成「版本号不一致」，看不出真因是「Cargo.toml 结构变了」。 */
  fail('解析不到 crate 名', [
    'src-tauri/Cargo.toml 的 [package] 段里找不到 name = "..."。',
    '本脚本靠它定位 Cargo.lock 里的版本段；改名时必须保证该行仍存在。',
  ]);
}

if (archive.failures.length) {
  fail('归档工程版本被改动（应为冻结值）', [
    ...archive.failures,
    '',
    '归档工程 android-app/ 冻结在 0.3.6 / versionCode 9，永不追当前版本（见 android-app/ARCHIVED.md）。',
  ]);
}

/* 分轨后最隐蔽的坏法：包本身是对的，只有文件名用了桌面号（V0.11.33 实测踩过一次）。 */
const scriptFailures = androidScriptsUseMobileVersion();
if (scriptFailures.length) {
  fail('安卓出包脚本没有统一从 platform-versions.json 取号', [
    ...scriptFailures,
    '',
    '手机版号在 V0.11.33 起独立：`android-apk.mjs` 写进 tauri.properties，`android-sign.mjs` 命名产物，',
    '两处必须同源。任何一处读 tauri.conf.json，产出的包名或版本号就会是桌面的。',
  ]);
}

/* ---------------------------------------------------------------- 桌面：六处 == desktop */
const off = entries.filter(([, v]) => v !== platform.desktop);
if (missing.length || off.length) {
  console.error(`[version] FAILED — 桌面六处与 platform-versions.json 的 desktop（${platform.desktop}）不一致\n`);
  for (const [file, v] of entries) {
    const mark = !v ? '?' : v === platform.desktop ? ' ' : '×';
    console.error(`  ${mark} ${file.padEnd(42)} ${v ?? '（未解析到）'}`);
  }
  console.error(
    '\n规则：桌面六处必须同为 platform-versions.json 里的 desktop；' +
      '手机版号在同一个文件的 mobile 里，两边互不牵连。改版时一起改，并写 CHANGELOG.md。',
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ 手机：自己一套 */
const mobile = platform.mobile;
if (!mobile?.versionName || !Number.isInteger(mobile.versionCode)) {
  fail('scripts/platform-versions.json 的 mobile 不完整', [
    '需要 versionName（"MAJOR.MINOR.PATCH"）与整数 versionCode 两项。',
    `实际读到：${JSON.stringify(mobile)}`,
  ]);
}

/* versionCode 必须能从 versionName 推出来：只改一个的话，系统会按旧号判重，
   用户装了新版却仍是旧号，下一次升级就再也升不上去。 */
const expectCode = versionCodeOf(mobile.versionName);
if (mobile.versionCode !== expectCode) {
  fail('手机 versionCode 与 versionName 不同源', [
    `versionName=${mobile.versionName} → 公式算得 ${expectCode}，实际写 ${mobile.versionCode}`,
    '两者必须同步 +1（公式 major*1_000_000 + minor*1_000 + patch，与 tauri CLI 一致）。',
  ]);
}

/* 版号只许增不许减：Android 不允许降级覆盖安装，用户看到的是「应用未安装」，
   不是「版本旧了」——这条得由门禁拦，不能靠人记（0.11.30 之后连着几轮都动过手机号）。 */
const shipped = shippedMobile().sort(cmpVer);
const newest = shipped[shipped.length - 1];
if (newest && cmpVer(mobile.versionName, newest) < 0) {
  fail('手机版号往回退了（会导致覆盖安装失败）', [
    `platform-versions.json 写 ${mobile.versionName}，但 release/ 里已发出 ${newest}`,
    'Android 拒绝降级覆盖安装，用户看到的是「应用未安装」而不是「版本旧了」。',
    '要么把 mobile 两项一起加到不低于已发布的最大号，要么确认那个包是误发的并手工挪出 release/。',
  ]);
}

const shippedTail = `已发出最大 ${newest ?? '无'}；归档冻结 ${archive.rows.join(' / ')}`;
console.log(`[version] OK — 桌面 ${platform.desktop}（六处一致）；手机 ${mobile.versionName} / ${mobile.versionCode}（${shippedTail}）`);
