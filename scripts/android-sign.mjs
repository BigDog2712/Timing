#!/usr/bin/env node
// Android APK 签名（zipalign → apksigner）
//
// 背景：`assembleRelease` 的产物恒为 `app-<flavor>-release-unsigned.apk`，**没有签名**。
// 这种包传到手机上，安装器连解析都过不了，报「解析软件包时出现问题」——不是包坏了，
// 是压根没签名。Gradle 的 assembleDebug 会自动用调试证书签，release 不会。
//
// 签名证书从 `src-tauri/gen/android/keystore.properties` 读（Tauri 官方约定的位置），
// 格式与 Tauri 文档一致：
//   storeFile=timing-release.jks     # 相对 gen/android，也可写绝对路径
//   storePassword=...
//   keyAlias=timing
//   keyPassword=...
//
// 用法：
//   node scripts/android-sign.mjs                       # 签最新 release 产物 → release\ 下
//   node scripts/android-sign.mjs --apk <路径>           # 签指定 APK
//   node scripts/android-sign.mjs --debug-key           # 用本机调试证书签（自用/侧载）
//
// 注意：证书一旦被装过的手机认下，换证书必须**先卸载**再装（签名不一致的系统级限制）。
// 所以 `--debug-key` 只适合「先在自己机器上跑起来看看」，正式分发要用自己的 keystore。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEN_ANDROID = join(ROOT, 'src-tauri', 'gen', 'android');
const IS_WIN = process.platform === 'win32';

function parseArgs(argv) {
  const out = { apk: null, debugKey: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') out.apk = argv[++i];
    else if (a === '--debug-key') out.debugKey = true;
    else if (a === '--help' || a === '-h') {
      console.log('用法: node scripts/android-sign.mjs [--apk <apk路径>] [--debug-key]');
      process.exit(0);
    } else {
      console.error(`不认识的参数: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function findSdk() {
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
  throw new Error('找不到 Android SDK：请设置 ANDROID_HOME 或在 gen/android/local.properties 写 sdk.dir');
}

/** build-tools 取版本号最大的一个（zipalign / apksigner 都在这） */
function findBuildTools(sdk) {
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) throw new Error(`找不到 build-tools：${root}`);
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const versions = readdirSync(root).filter((v) => /^\d+\./.test(v)).sort(cmp);
  if (!versions.length) throw new Error(`${root} 下没有已安装的 build-tools`);
  return join(root, versions[versions.length - 1]);
}

function readKeystoreProps() {
  const p = join(GEN_ANDROID, 'keystore.properties');
  if (!existsSync(p)) return null;
  const kv = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const rawFile = kv.storeFile ?? kv.storefile;
  if (!rawFile) return null;
  return {
    storeFile: isAbsolute(rawFile) ? rawFile : resolve(GEN_ANDROID, rawFile),
    storePassword: kv.storePassword ?? kv.storepassword ?? '',
    keyAlias: kv.keyAlias ?? kv.keyalias ?? '',
    keyPassword: kv.keyPassword ?? kv.keypassword ?? '',
  };
}

/** 最新的 release 产物（Gradle 每次覆盖同一个文件名，取 mtime 最新即可） */
function latestUnsignedApk() {
  const dir = join(GEN_ANDROID, 'app', 'build', 'outputs', 'apk');
  if (!existsSync(dir)) throw new Error(`还没有产物：${dir}（先跑 node scripts/android-apk.mjs）`);
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.apk')) found.push(full);
    }
  };
  walk(dir);
  if (!found.length) throw new Error(`${dir} 下没有 .apk`);
  // 优先 release，其次最新写的
  found.sort((a, b) => {
    const ar = /release/.test(a) ? 1 : 0;
    const br = /release/.test(b) ? 1 : 0;
    return ar - br;
  });
  return found[found.length - 1];
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`命令失败（exit ${r.status}）：${[cmd, ...args].join(' ')}`);
}

function main() {
  const { apk, debugKey } = parseArgs(process.argv.slice(2));
  const sdk = findSdk();
  const bt = findBuildTools(sdk);

  const javaHome = process.env.JAVA_HOME ?? process.env.JDK_HOME;
  const java = javaHome ? join(javaHome, 'bin', IS_WIN ? 'java.exe' : 'java') : IS_WIN ? 'java.exe' : 'java';

  const input = apk ? resolve(apk) : latestUnsignedApk();
  if (!existsSync(input)) throw new Error(`APK 不存在：${input}`);

  const ks = debugKey
    ? {
        storeFile: join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.android', 'debug.keystore'),
        storePassword: 'android',
        keyAlias: 'androiddebugkey',
        keyPassword: 'android',
      }
    : readKeystoreProps();
  if (!ks) {
    throw new Error(
      `没有签名证书：${join(GEN_ANDROID, 'keystore.properties')} 不存在。\n` +
        '  · 自用/侧载：加 --debug-key，用本机调试证书签（换证书要卸载重装）\n' +
        '  · 正式分发：按 docs 里的说明生成 keystore 并写 keystore.properties',
    );
  }
  if (!existsSync(ks.storeFile)) throw new Error(`keystore 文件不存在：${ks.storeFile}`);

  const base = input.replace(/\.apk$/i, '');
  const aligned = `${base}-aligned.apk`;
  const signed = `${base}-signed.apk`;

  console.log(`输入   ${input}`);
  console.log(`证书   ${ks.storeFile}   alias=${ks.keyAlias}`);

  run(join(bt, IS_WIN ? 'zipalign.exe' : 'zipalign'), ['-p', '-f', '4', input, aligned]);
  run(
    java,
    [
      '-jar',
      join(bt, 'lib', 'apksigner.jar'),
      'sign',
      '--ks',
      ks.storeFile,
      '--ks-pass',
      `pass:${ks.storePassword}`,
      '--key-pass',
      `pass:${ks.keyPassword}`,
      '--ks-key-alias',
      ks.keyAlias,
      '--out',
      signed,
      aligned,
    ],
    { stdio: 'inherit' },
  );
  run(java, ['-jar', join(bt, 'lib', 'apksigner.jar'), 'verify', signed]);

  // 归档到 release\，文件名带上签名来源，免得以后分不清哪个能装
  const tag = debugKey ? 'debugsigned' : 'signed';
  /* [V0.11.33] 手机版号独立：这里的 version 必须与上一个脚本写进 APK 的 `versionName` 同源，
     也就是 `platform-versions.json` 的 `mobile.versionName`。
     从 `tauri.conf.json` 读会拿到**桌面号**——V0.11.33 实测踩过：
     APK 里明明是 0.11.33，文件名却成了 `Timing-android-0.11.27-…apk`，
     于是「recency 看文件名」的归档、校验和、安装说明全部对不上。 */
  const mobile = JSON.parse(
    readFileSync(join(ROOT, 'scripts', 'platform-versions.json'), 'utf8'),
  ).mobile;
  const version = mobile?.versionName;
  if (!version) {
    throw new Error(
      'scripts/platform-versions.json 里读不到 mobile.versionName' +
        '（手机版号在 V0.11.33 起独立，不再跟 tauri.conf.json 的桌面号走）',
    );
  }
  const destName = input.includes('debug')
    ? `Timing-android-${version}-debug-arm64-${tag}.apk`
    : `Timing-android-${version}-release-arm64-${tag}.apk`;
  const outDir = join(ROOT, 'release');
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, destName);
  copyFileSync(signed, dest);
  rmSync(aligned, { force: true });
  rmSync(signed, { force: true });

  console.log(`\n已签名 → ${dest}`);
  console.log('可直接拷到手机上安装（arm64）。');
}

try {
  main();
} catch (e) {
  console.error(`\n失败：${e.message}`);
  process.exit(1);
}
