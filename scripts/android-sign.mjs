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
//   node scripts/android-sign.mjs --apk <路径>            # 签指定 APK → release\ 下
//   node scripts/android-sign.mjs --apk <路径> --debug-key # 用本机调试证书签（自用/侧载）
//
// 注意：证书一旦被装过的手机认下，换证书必须**先卸载**再装（签名不一致的系统级限制）。
// 所以 `--debug-key` 只适合「先在自己机器上跑起来看看」，正式分发要用自己的 keystore。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  if (!out.apk) throw new Error('--apk 必填；请传入本次构建的精确 APK 路径');
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

export function expectedApkName(abi, variant) {
  const flavors = { 'arm64-v8a': 'arm64', 'armeabi-v7a': 'arm', x86_64: 'x86_64', x86: 'x86' };
  const flavor = flavors[abi];
  if (!flavor || !['release', 'debug'].includes(variant)) throw new Error(`不支持 APK 变体：${abi}/${variant}`);
  return `app-${flavor.toLowerCase()}-${variant}.apk`;
}

export function archiveApkName(version, abi, variant, tag) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error(`无效 versionName: ${version}`);
  const flavor = { 'arm64-v8a': 'arm64', 'armeabi-v7a': 'arm', x86_64: 'x86_64', x86: 'x86' }[abi];
  if (!flavor || !['release', 'debug'].includes(variant)) throw new Error(`不支持 APK 变体：${abi}/${variant}`);
  return `Timing-android-${version}-${variant}-${flavor}-${tag}.apk`;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`命令失败（exit ${r.status}）：${cmd}`);
}

export function signingCommand(jar, keystore, input, output) {
  return {
    args: [
      '-jar', jar, 'sign', '--ks', keystore.storeFile,
      '--ks-pass', 'env:TIMING_APK_STORE_PASSWORD',
      '--key-pass', 'env:TIMING_APK_KEY_PASSWORD',
      '--ks-key-alias', keystore.keyAlias, '--out', output, input,
    ],
    options: {
      env: {
        ...process.env,
        TIMING_APK_STORE_PASSWORD: keystore.storePassword,
        TIMING_APK_KEY_PASSWORD: keystore.keyPassword,
      },
    },
  };
}

function main() {
  const { apk, debugKey } = parseArgs(process.argv.slice(2));
  if (debugKey && !apk) throw new Error('--debug-key 需要配合 --apk 使用');
  const sdk = findSdk();
  const bt = findBuildTools(sdk);

  const javaHome = process.env.JAVA_HOME ?? process.env.JDK_HOME;
  const java = javaHome ? join(javaHome, 'bin', IS_WIN ? 'java.exe' : 'java') : IS_WIN ? 'java.exe' : 'java';

  const input = resolve(apk);
  if (!input.toLowerCase().endsWith('.apk')) throw new Error(`输入不是 APK：${input}`);
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
  const signing = signingCommand(join(bt, 'lib', 'apksigner.jar'), ks, aligned, signed);
  run(java, signing.args, signing.options);
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
  const variant = /(?:^|[-\\/])debug(?:[-\\/]|$)/i.test(input) ? 'debug' : 'release';
  const abi = /armeabi-v7a|app-arm-/i.test(input) ? 'armeabi-v7a'
    : /x86_64|app-x86_64-/i.test(input) ? 'x86_64'
      : /(?:^|[-\\/])x86(?:[-\\/]|$)|app-x86-/i.test(input) ? 'x86'
        : 'arm64-v8a';
  const expectedSource = expectedApkName(abi, variant);
  /* Gradle 的 release 产物恒带 `-unsigned` 后缀（assembleRelease 从不签名）；
     比对时剥掉它，调用方传的正是 android-apk.mjs 打出来的那个文件名。 */
  const sourceStem =
    input.split(/[\\/]/).at(-1)?.toLowerCase().replace(/-unsigned\.apk$/, '.apk') ?? '';
  if (sourceStem !== expectedSource.toLowerCase()) {
    throw new Error(`APK 名称与 ABI/变体不符，应为 ${expectedSource}：${input}`);
  }
  const destName = archiveApkName(version, abi, variant, tag);
  const outDir = join(ROOT, 'release');
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, destName);
  copyFileSync(signed, dest);
  rmSync(aligned, { force: true });
  rmSync(signed, { force: true });

  console.log(`\n已签名 → ${dest}`);
  console.log('可直接拷到手机上安装（arm64）。');
}

if (!process.env.NODE_TEST_CONTEXT) {
  try {
    main();
  } catch (e) {
    console.error(`\n失败：${e.message}`);
    process.exit(1);
  }
}
