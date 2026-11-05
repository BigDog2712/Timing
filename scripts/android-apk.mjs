#!/usr/bin/env node
// Android APK 构建（Windows 无开发者模式 / 无符号链接权限时的降级路径）
//
// 背景：`tauri android build` 会把 Rust 产出的 .so **符号链接**到
// `src-tauri/gen/android/app/src/main/jniLibs/<abi>/`，而 Windows 创建符号链接需要
// 「开发者模式」或管理员权限（Tauri 官方文档对此有明确要求）。
// 本脚本改为「编译 → 复制 .so → 直接调 Gradle」，全程不需要任何附加权限。
//
// 用法：
//   node scripts/android-apk.mjs                      # release, arm64-v8a
//   node scripts/android-apk.mjs --abi armeabi-v7a    # 指定 ABI（一次一个）
//   node scripts/android-apk.mjs --debug              # debug 变体
//
// 产物：src-tauri/gen/android/app/build/outputs/apk/<flavor>/<variant>/*.apk
// 注意：release 产物未签名（与 tauri CLI 行为一致），分发前需自行签名。

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEN_ANDROID = join(ROOT, 'src-tauri', 'gen', 'android');
const IS_WIN = process.platform === 'win32';

/** ABI → Rust target / Gradle flavor / NDK clang 前缀（API 24 = app 的 minSdk） */
const ABIS = {
  'arm64-v8a': { target: 'aarch64-linux-android', flavor: 'Arm64', clangPrefix: 'aarch64-linux-android24' },
  'armeabi-v7a': { target: 'armv7-linux-androideabi', flavor: 'Arm', clangPrefix: 'armv7a-linux-androideabi24' },
  x86_64: { target: 'x86_64-linux-android', flavor: 'X86_64', clangPrefix: 'x86_64-linux-android24' },
  x86: { target: 'i686-linux-android', flavor: 'X86', clangPrefix: 'i686-linux-android24' },
};

function parseArgs(argv) {
  const out = { abi: 'arm64-v8a', variant: 'release' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--abi') out.abi = argv[++i];
    else if (a === '--debug') out.variant = 'debug';
    else if (a === '--help' || a === '-h') {
      console.log('用法: node scripts/android-apk.mjs [--abi <arm64-v8a|armeabi-v7a|x86_64|x86>] [--debug]');
      process.exit(0);
    } else {
      console.error(`不认识的参数: ${a}`);
      process.exit(1);
    }
  }
  if (!ABIS[out.abi]) {
    console.error(`不支持的 ABI: ${out.abi}（可选: ${Object.keys(ABIS).join(' / ')}）`);
    process.exit(1);
  }
  return out;
}

function findAndroidSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const localProps = join(GEN_ANDROID, 'local.properties');
  if (existsSync(localProps)) {
    const line = readFileSync(localProps, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('sdk.dir='));
    if (line) return line.slice('sdk.dir='.length).replace(/\\:/g, ':').replace(/\\\\/g, '\\');
  }

  const guess = join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  if (existsSync(guess)) return guess;
  throw new Error('找不到 Android SDK：请设置 ANDROID_HOME，或在 gen/android/local.properties 写 sdk.dir');
}

/** 取 NDK：优先 NDK_HOME，否则在 <sdk>/ndk 下取版本号最大的一个 */
function findNdk(sdk) {
  const fromEnv = process.env.NDK_HOME;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const ndkRoot = join(sdk, 'ndk');
  if (!existsSync(ndkRoot)) throw new Error(`找不到 NDK：${ndkRoot} 不存在`);

  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const versions = readdirSync(ndkRoot).filter((v) => /^\d+\./.test(v)).sort(cmp);
  if (!versions.length) throw new Error(`${ndkRoot} 下没有已安装的 NDK`);
  return join(ndkRoot, versions[versions.length - 1]);
}

function run(cmd, args, opts = {}) {
  const printable = [cmd, ...args].join(' ');
  console.log(`\n$ ${printable}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`命令失败（exit ${r.status}）：${printable}`);
}

function main() {
  const { abi, variant } = parseArgs(process.argv.slice(2));
  const cfg = ABIS[abi];
  const sdk = findAndroidSdk();
  const ndk = findNdk(sdk);

  if (!process.env.JAVA_HOME && !process.env.JDK_HOME) {
    throw new Error('未设置 JAVA_HOME（Gradle 需要 JDK 17+）；设置后重试，例如：setx JAVA_HOME "<jdk 路径>"');
  }

  const hostTag = IS_WIN ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const llvmBin = join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag, 'bin');
  if (!existsSync(llvmBin)) throw new Error(`NDK 编译器目录不存在：${llvmBin}`);

  const exe = (name) => join(llvmBin, IS_WIN ? `${name}.cmd` : name);
  const bin = (name) => join(llvmBin, IS_WIN ? `${name}.exe` : name);

  // 所有编译器/打包器都指向 NDK 自带 LLVM（libsqlite3-sys 需要 CC 编 sqlite3.c）
  const key = cfg.target.replace(/-/g, '_');
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    NDK_HOME: ndk,
    [`CC_${key}`]: exe(`${cfg.clangPrefix}-clang`),
    [`CXX_${key}`]: exe(`${cfg.clangPrefix}-clang++`),
    [`AR_${key}`]: bin('llvm-ar'),
    [`RANLIB_${key}`]: bin('llvm-ranlib'),
    [`CARGO_TARGET_${cfg.target.toUpperCase().replace(/-/g, '_')}_LINKER`]: exe(`${cfg.clangPrefix}-clang`),
  };

  const release = variant === 'release';
  console.log(`ABI=${abi}  变体=${variant}`);
  console.log(`SDK=${sdk}`);
  console.log(`NDK=${ndk}`);
  console.log(`JAVA_HOME=${process.env.JAVA_HOME}`);

  // 1. 前端静态资源（等价于 tauri.conf.json 的 build.beforeBuildCommand）
  //    [V0.11.2] 必须显式注入 TAURI_ENV_FAMILY=mobile：`vite.config.ts` 靠它决定
  //    `__TIMING_MOBILE__`，而本脚本是直接调 npm（不经 tauri CLI），不设就会把**桌面版**
  //    前端打进 APK —— 装到手机上是一个没有 MobileShell 的空白/错版界面。
  const webEnv = { ...env, TAURI_ENV_FAMILY: 'mobile' };
  run(IS_WIN ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, env: webEnv, shell: IS_WIN });

  // 2. Rust 动态库
  //    [V0.11.3] 必须带 `--features custom-protocol`：不开这个特性时 tauri 不把
  //    dist\ 编进 .so，运行时去找 devUrl（http://localhost:1420）——装到手机上就是
  //    一个纯白窗口，连不上任何服务器。桌面端 build-release.cmd 同理（那里早就带了）。
  const cargoArgs = [
    'build',
    '--manifest-path',
    join(ROOT, 'src-tauri', 'Cargo.toml'),
    '--target',
    cfg.target,
    '--features',
    'custom-protocol',
  ];
  if (release) cargoArgs.push('--release');
  run(IS_WIN ? 'cargo.exe' : 'cargo', cargoArgs, { cwd: ROOT, env, shell: false });

  // 3. .so → jniLibs（复制，而非符号链接）
  //    android target 的产物恒为 lib<name>.so，与宿主平台无关
  const profileDir = release ? 'release' : 'debug';
  const built = join(ROOT, 'src-tauri', 'target', cfg.target, profileDir, 'libtiming_lib.so');
  if (!existsSync(built)) throw new Error(`Rust 产物不存在：${built}`);

  const jniDir = join(GEN_ANDROID, 'app', 'src', 'main', 'jniLibs', abi);
  mkdirSync(jniDir, { recursive: true });
  const dest = join(jniDir, 'libtiming_lib.so');
  copyFileSync(built, dest);
  console.log(`\n已复制 → ${dest}`);

  // 3.5 自检：前端资源是否真的编进了 .so
  //     开了 custom-protocol 后 dist 里每个文件的路径都会以 "/assets/..." 字面量落在
  //     .so 的只读段；没开就是零命中——那正是「装上去了但一开就白屏」的形态。宁可在这里
  //     报错，也不要再产一个装不上/打不开的包给用户试。
  if (!readFileSync(dest).includes('/assets/')) {
    throw new Error(
      'libtiming_lib.so 内找不到内嵌前端资源（/assets/ 零命中），这个 APK 装上去会白屏。' +
        ' 排查：cargo 是否带了 --features custom-protocol；dist/ 是否是 TAURI_ENV_FAMILY=mobile 的产物。',
    );
  }
  console.log('自检：.so 内已内嵌前端资源（/assets/ 有命中）');

  // 4. Gradle 打包（跳过 rustBuild*，第 2/3 步已完成）
  const gradle = join(GEN_ANDROID, IS_WIN ? 'gradlew.bat' : 'gradlew');
  const cap = release ? 'Release' : 'Debug';
  run(gradle, [`:app:assemble${cfg.flavor}${cap}`, '-x', `:app:rustBuild${cfg.flavor}${cap}`], {
    cwd: GEN_ANDROID,
    env,
    shell: IS_WIN,
  });

  const apkDir = join(GEN_ANDROID, 'app', 'build', 'outputs', 'apk', cfg.flavor.toLowerCase(), variant);
  console.log(`\n完成：${apkDir}`);

  // 5. 签名
  //    release 变体的产物恒为 `*-unsigned.apk`，不签名装不上（安装器报「解析软件包时出现问题」）。
  //    有 keystore.properties 就顺手签掉；没有就明确提示，别让人拿一个装不上的包去试。
  if (!release) {
    console.log('debug 变体由 Gradle 自动用调试证书签名，可直接安装。');
    return;
  }
  if (existsSync(join(GEN_ANDROID, 'keystore.properties'))) {
    console.log('\n检测到 keystore.properties，开始签名…');
    run(process.execPath, [join(ROOT, 'scripts', 'android-sign.mjs')], { cwd: ROOT, env });
  } else {
    console.log(
      '\n[注意] release 产物未签名，直接装会报「解析软件包时出现问题」。\n' +
        '       自用：node scripts/android-sign.mjs --debug-key\n' +
        '       正式：在 src-tauri/gen/android/keystore.properties 配好证书后重跑本脚本',
    );
  }
}

try {
  main();
} catch (e) {
  console.error(`\n失败：${e.message}`);
  process.exit(1);
}
