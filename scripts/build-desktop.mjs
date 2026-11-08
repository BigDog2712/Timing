#!/usr/bin/env node
/**
 * Timing — 桌面产物构建（V0.11.6，ADR-051 §2「双形态打包」）
 * -----------------------------------------------------------------------------
 * 用法：
 *   node scripts/build-desktop.mjs              两者都出（便携 zip + NSIS 安装包）
 *   node scripts/build-desktop.mjs --portable   只出便携版（`tauri build --no-bundle`）
 *   node scripts/build-desktop.mjs --installer  只出安装包（`tauri build --bundles nsis`）
 *
 * ## 一次 Rust 编译，两种形态
 *
 * `--bundles nsis` 这条路径**同时产出** `target/release/timing.exe` 与 NSIS 安装包，
 * 所以「两者都要」时只跑一次 `tauri build`，便携版直接复用那个 exe。
 * 反过来（先 `--no-bundle` 再 `--bundles nsis`）实测会让 cargo 重编整个 crate
 * 2m06s：`--no-bundle` 改变了内嵌的 config 指纹，两次调用的产物不可复用。
 *
 * ## 为什么不用 `cargo clean -p timing`
 *
 * `dist/` 里的前端资源是 `generate_context!` 用 `include_dir` 嵌进二进制的，cargo
 * **不把 `dist/` 当输入**——只重建 dist 会让 exe 里留着上一版 UI（旧版
 * `build-release.cmd` 靠 `cargo clean --release -p timing` 绕过，代价是整 crate 重编）。
 * 这里改成：构建完前端后对 `dist/` 做内容指纹，与上次落盘的指纹比对；不一致才
 * `touch src-tauri/build.rs` ——mtime 变化会让 cargo 重跑 build script 并重编该 crate，
 * 效果等同 `cargo clean -p timing` 但要重编的东西少得多。
 *
 * 用**内容指纹**而不是 mtime：vite 每次 build 都重写文件，mtime 必变，按 mtime 判
 * 「dist 变了」等于每次都判变，退化成每次全量重编。
 *
 * ## 构建身份（V0.11.20）
 *
 * `target/.timing-dist-stamp` 是**前端内容**指纹，与 commit 无关：装完包无法回答
 * 「这是哪个 commit 编的」。所以出包时另写一份 `BUILD-INFO.txt`，同时落两处：
 *
 *   release/Timing-<ver>-portable/BUILD-INFO.txt   → 进 zip，解压即见
 *   release/BUILD-INFO-<ver>.txt                   → 与 zip / setup 同级，不解压就能核对
 *
 * 内容是 `product / version / git_commit / git_dirty / built_at_utc / build_profile`
 * 六行键值（UTF-8 + LF）。commit 与干净状态**现场问 git**；git 不可用时写 `unknown`
 * 而不是让打包失败（见 `gitIdentity`）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcTauri = join(root, 'src-tauri');
const releaseDir = join(root, 'release');
const distDir = join(root, 'dist');
const exePath = join(srcTauri, 'target', 'release', 'timing.exe');
const nsisDir = join(srcTauri, 'target', 'release', 'bundle', 'nsis');
const stampPath = join(srcTauri, 'target', '.timing-dist-stamp');
const overridePath = join(srcTauri, 'target', '.timing-no-hook.json');

/* Windows 自带的 `tar.exe` 是 libarchive 的 bsdtar（`-a` 能按扩展名写 zip）。
   **必须用绝对路径**：PATH 上更靠前的常是 Git 的 GNU tar，它的 `-a` 只选压缩算法，
   对 `.zip` 无能为力，而且会把 `D:\...` 当成远程主机名报
   「Cannot connect to D: resolve failed」。 */
const tarExe = existsSync('C:\\Windows\\System32\\tar.exe')
  ? 'C:\\Windows\\System32\\tar.exe'
  : 'tar';

const argv = new Set(process.argv.slice(2));
for (const flag of argv) {
  if (flag !== '--portable' && flag !== '--installer') {
    console.error(`[build] 未知参数 ${flag}`);
    console.error('       可用：--portable / --installer（都不给 = 两者都出）');
    process.exit(2);
  }
}
const wantPortable = argv.has('--portable') || argv.size === 0;
const wantInstaller = argv.has('--installer') || argv.size === 0;

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const log = (msg) => console.log(`[build] ${msg}`);
const win = process.platform === 'win32';
/** 给外部命令用的相对路径（避开 bsdtar / cmd 对盘符冒号的各自解读）。 */
const relPath = (p) => relative(root, p).split(sep).join('/');

/**
 * 构建身份（V0.11.20）：包里唯一能回答「这是哪个 commit 编的」的东西。
 *
 * 在此之前包里唯一的指纹是 `target/.timing-dist-stamp`，那是**前端 dist 内容哈希**，
 * 与 commit 无关 —— 同一份 commit 改一次注释也会变，而 checkout 到任意 commit 只要前端
 * 没变就是同一个值。用户报问题时拿着安装包，我们无法倒推出源码版本。
 *
 * **必须现场问 git**（`git rev-parse HEAD` / `git status --porcelain`），不许硬编码、
 * 不许读缓存文件：硬编码会在某次忘记改的时候静默撒谎，读缓存文件会把上一次的 commit
 * 贴到这一次的包上 —— 两种都让这份文件失去意义，不如没有。
 *
 * `git` 不可用（源码是解压出来的 tarball / 机器上没装 git / git 挂在半路）时返回
 * `unknown`，**不许让构建脚本崩**：打不出包比打出一个标注「未知来源」的包更糟。
 */
function gitIdentity() {
  const ask = (args) => {
    const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (res.error || res.status !== 0) return null;
    return typeof res.stdout === 'string' ? res.stdout.trim() : null;
  };
  const commit = ask(['rev-parse', 'HEAD']);
  const porcelain = ask(['status', '--porcelain']);
  return {
    commit: commit && commit.length > 0 ? commit : 'unknown',
    /* 空输出 = 工作树干净；`null`（git 挂了）也只能说「不知道」。 */
    dirty: porcelain == null ? 'unknown' : porcelain.length === 0 ? 'clean' : 'dirty',
  };
}

/** `BUILD-INFO.txt` 正文：键值形式、UTF-8、**LF**（跨平台比对时不会被 CRLF 坑）。 */
function buildInfoText(identity, builtAtUtc) {
  return (
    [
      'product: Timing',
      `version: ${version}`,
      `git_commit: ${identity.commit}`,
      `git_dirty: ${identity.dirty}`,
      `built_at_utc: ${builtAtUtc}`,
      'build_profile: release',
    ].join('\n') + '\n'
  );
}

/* 在**构建开始时**取一次身份：此时工作树状态才是「我编的这份源码」的状态。
   `built_at_utc` 留到二进制出来之后再取（见第 2 步末尾），两份 BUILD-INFO 用同一个值。 */
const identity = gitIdentity();

/**
 * 跑一个外部命令；失败即退出（构建脚本没有「继续」的语义）。
 *
 * `shell` 只对 `npm` 用：Node 20+ 在 Windows 上不允许直接 spawn `.cmd`
 * （`EINVAL`），而 `npm` 只有 `.cmd` 入口。其余命令（`tar` / `node`）保持
 * 不经 shell，参数里带空格或中文都不会被 cmd.exe 二次解析。
 */
function run(cmd, args, cwd, shell = false) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell });
  if (res.error) {
    console.error(`[build] 无法启动 ${cmd}：${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[build] ${cmd} 退出码 ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

/** 递归收集文件（稳定排序，保证指纹可复现）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** `dist/` 的内容指纹：相对路径 + 内容 sha256（取前 16 位）。 */
function distFingerprint() {
  const hash = createHash('sha256');
  for (const file of walk(distDir)) {
    hash.update(`${relPath(file)}\u0000`);
    hash.update(createHash('sha256').update(readFileSync(file)).digest('hex'));
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, 16);
}

/** 前端资源变了才把 build.rs 的 mtime 推到「现在」，逼 cargo 重编。 */
function stampDist() {
  const next = distFingerprint();
  const prev = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';
  if (prev === next) {
    log(`dist 指纹未变（${next}），沿用已有二进制`);
    return;
  }
  const buildRs = join(srcTauri, 'build.rs');
  const now = new Date();
  utimesSync(buildRs, now, now);
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, `${next}\n`, 'utf8');
  log(`dist 指纹 ${prev || '(无)'} → ${next}，已 touch build.rs 强制重新内嵌前端资源`);
}

/** tauri CLI 走 node 直接执行：绕开 Windows 上 `.cmd` 与 shell 引号的问题。 */
function tauri(args) {
  run(process.execPath, [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), ...args], root);
}

/**
 * 流式计算文件的 sha256（1 MiB 一块）。
 *
 * 为什么不用 `certutil -hashfile`：它输出的是本地化文本（中文系统上「哈希算法」那一行
 * 会变），解析比算哈希更容易错；`crypto` 也不依赖 PATH 上有没有 certutil。
 */
function sha256File(path) {
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(1 << 20);
  const fd = openSync(path, 'r');
  try {
    let read;
    while ((read = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 统计目录体积，并挑出「不该出现在产物里」的扩展名（QR-3 兜底：别把用户数据打进去）。 */
function inspect(dir) {
  const files = walk(dir);
  const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const suspicious = files.filter((f) => /\.(db|db-wal|db-shm|md)$/i.test(f));
  for (const f of suspicious) {
    console.error(`[build] ⚠ 产物里出现数据文件 ${relPath(f)}（体积异常 / 可能带出用户数据）`);
  }
  return { count: files.length, total, suspicious: suspicious.length };
}

// ---------------------------------------------------------------------------
// 1. 前端：自己先构建，才能拿指纹判断「要不要重编 Rust」
// ---------------------------------------------------------------------------
mkdirSync(releaseDir, { recursive: true });
log('[1/4] 构建前端（tsc + vite build）');
run(win ? 'npm.cmd' : 'npm', ['run', 'build'], root, win);
stampDist();

// `tauri build` 默认会再跑一次 `beforeBuildCommand`。前端已构建完，这里用一份覆盖
// 配置把它清空，避免同一份 dist 被编两遍（--config 只做浅层合并，不影响其它字段）。
//
// **内容没变就不重写**：`tauri-build` 会把解析后的配置当 build-script 输入，覆盖文件
// 的 mtime 一动 = 整 crate 重编（实测每次多花 2 分钟）。这也解释了为什么必须写进
// `target/`（不会进版本库），而不是每次现造一个临时文件。
mkdirSync(dirname(overridePath), { recursive: true });
const overrideJson = JSON.stringify({ build: { beforeBuildCommand: '' } });
if (!existsSync(overridePath) || readFileSync(overridePath, 'utf8') !== overrideJson) {
  writeFileSync(overridePath, overrideJson, 'utf8');
}
const override = ['--config', overridePath];

// ---------------------------------------------------------------------------
// 2. Rust：一次调用拿齐 exe（需要安装包时连 NSIS 一起）
// ---------------------------------------------------------------------------
log(`[2/4] 编译 release 二进制（${wantInstaller ? '--bundles nsis' : '--no-bundle'}）`);
tauri(['build', ...(wantInstaller ? ['--bundles', 'nsis'] : ['--no-bundle']), ...override]);

if (!existsSync(exePath)) {
  console.error(`[build] 没找到 ${exePath}，无法继续`);
  process.exit(1);
}

const results = [];

/* `built_at_utc` 在这里取：上一行刚确认过二进制存在，这一刻才是「打完了」。
   两份 BUILD-INFO（便携目录里 / `release/` 同级）共用这一个值，不会各写一个时间。 */
const builtAtUtc = new Date().toISOString();
const buildInfo = buildInfoText(identity, builtAtUtc);
log(`构建身份：${identity.commit}${identity.dirty === 'dirty' ? '（工作树有改动）' : ''}`);

// ---------------------------------------------------------------------------
// 3. 便携形态：Timing-<ver>-portable\ + zip
//
// **staging 目录不删是故意的**：它既是 zip 的源，也是可以直接拷贝的成品
// （比先解压 zip 更省事）。所以 `release\Timing-<ver>-portable\` 留在磁盘上，
// 下一次构建会用 `rmSync` 精确重建它——不是「忘记清理」。
// ---------------------------------------------------------------------------
if (wantPortable) {
  log('[3/4] 组装便携版');
  const dirName = `Timing-${version}-portable`;
  const stageDir = join(releaseDir, dirName);
  const zipPath = join(releaseDir, `${dirName}.zip`);

  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(join(stageDir, 'data'), { recursive: true });
  mkdirSync(join(stageDir, 'plugins'), { recursive: true });
  cpSync(exePath, join(stageDir, 'Timing.exe'));
  /* `data\README.txt` **从 `src-tauri/packaging/data-readme.txt` 读**，不在本文件里
     写字面量：宿主启动时要判断「这个 README 是不是我们放的」，判据是内容比对
     （`app::portable_boot::drop_own_readme`，它 `include_str!` 同一份文件）。两处各写
     一份文案，改一个字就会「删不掉自己的占位」→ 每个用户白留一份备份目录。
     说明文件同时起「占位」作用：空目录不进 zip，用户解压后会看不到这两个目录。 */
  writeFileSync(
    join(stageDir, 'data', 'README.txt'),
    readFileSync(join(srcTauri, 'packaging', 'data-readme.txt')),
  );
  writeFileSync(
    join(stageDir, 'plugins', 'README.txt'),
    '把插件文件夹放进这里（每个插件一个子目录，内有 plugin.json）。\r\n' +
      '删掉本文件不影响使用。\r\n',
    'utf8',
  );
  /* BUILD-INFO.txt 落在 staging 目录里 = 会进 zip = 用户解压即见。
     这是「绿色版到底是哪个 commit」的唯一答案，必须写。 */
  writeFileSync(join(stageDir, 'BUILD-INFO.txt'), buildInfo, 'utf8');

  rmSync(zipPath, { force: true });
  /* 从 `release/` 打包并点名**目录**，而不是 `-C stageDir .`：后者会把 zip 根当成
     staging 内容，用户解压到桌面得到散落的一堆文件。这样解压出来是**一个**
     `Timing-<ver>-portable/` 文件夹——「绿色便携版」的直觉形态。
     注意 `-C` 只给相对路径：bsdtar 对 `D:\...` 的盘符冒号有自己的解读。 */
  run(tarExe, ['-a', '-cf', relPath(zipPath), '-C', relPath(releaseDir), dirName], root);
  if (!existsSync(zipPath) || statSync(zipPath).size === 0) {
    console.error('[build] zip 没生成出来（bsdtar 不可用？）');
    process.exit(1);
  }

  const info = inspect(stageDir);
  results.push({
    kind: 'portable',
    path: zipPath,
    bytes: statSync(zipPath).size,
    note: `${info.count} 个文件 / 解压后 ${human(info.total)}`,
  });
} else {
  log('[3/4] 跳过便携版（--installer）');
}

// ---------------------------------------------------------------------------
// 4. 安装形态：把 NSIS 产物收到 release\ 下（版本化命名，便于多版本并存）
// ---------------------------------------------------------------------------
if (wantInstaller) {
  log('[4/4] 收集安装包');
  const produced = existsSync(nsisDir)
    ? readdirSync(nsisDir).filter((n) => n.toLowerCase().endsWith('-setup.exe'))
    : [];
  if (produced.length !== 1) {
    console.error(`[build] ${nsisDir} 里应有 1 个 *-setup.exe，实得 ${produced.length} 个`);
    console.error('        旧 setup 请挪进 release/archive/（不要在 bundle 目录里攒着）');
    process.exit(1);
  }
  const target = join(releaseDir, `Timing-${version}-setup.exe`);
  cpSync(join(nsisDir, produced[0]), target);
  results.push({ kind: 'installer', path: target, bytes: statSync(target).size, note: produced[0] });
} else {
  log('[4/4] 跳过安装包（--portable）');
}

// ---------------------------------------------------------------------------
// 5. 校验和 + 报告
//
// 清理口径（硬）：本脚本只 `rmSync` 自己产出的两个**确切路径**
// （`release/Timing-<ver>-portable/` 与同名 `.zip`），**任何** `release/*` 通配
// 清理都不允许加：`release/` 里躺着历史产物（旧 apk / 旧 exe / SHA256SUMS 等），
// 通配一加就是不可逆的数据丢失。
// ---------------------------------------------------------------------------

/* 与 zip / setup 同级的第二份 BUILD-INFO：不用解压就能核对「这个包是哪个 commit」。
   内容与便携目录里那份**逐字相同**（同一个 `buildInfo` 变量，不是各写一遍）。 */
const buildInfoPath = join(releaseDir, `BUILD-INFO-${version}.txt`);
writeFileSync(buildInfoPath, buildInfo, 'utf8');

/* 每版一个校验和文件（`SHA256SUMS-<ver>.txt`），**不覆盖**历史的 `SHA256SUMS.txt`
   ——那份是手写的、含 Android apk 的哈希记录，整份重算会把那段抹掉。 */
const sumsPath = join(releaseDir, `SHA256SUMS-${version}.txt`);
const sumsBody = results
  .map((r) => `${sha256File(r.path)}  ${basename(r.path)}`)
  .join('\n');
writeFileSync(sumsPath, `${sumsBody}\n`, 'utf8');

console.log('\n[build] 产物：');
for (const r of results) {
  console.log(`  ${r.kind.padEnd(9)} ${relPath(r.path)}  ${human(r.bytes)}  (${r.note})`);
}
console.log(`[build] 构建身份：${relPath(buildInfoPath)}`);
console.log(`[build] 校验和：${relPath(sumsPath)}`);
console.log(sumsBody);
console.log(`[build] 版本 ${version}；便携版数据目录 = 解压后的 Timing.exe 同级 data\\`);
