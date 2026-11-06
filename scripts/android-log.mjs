#!/usr/bin/env node
/**
 * Timing — 真机日志抓取
 * -----------------------------------------------------------------------------
 * 真机上唯一的"眼睛"：Rust 的 `log_info!` 与 Kotlin 的 `Log.i` 都打到 logcat 的
 * `Timing` 这个 tag 上（V0.11.11 起，见 `src-tauri/src/platform/log.rs`）。
 *
 * 用法：
 *   node scripts/android-log.mjs              # 清屏后实时跟随，同时写 release/logs/android-latest.log
 *   node scripts/android-log.mjs --keep       # 不清屏（保留刚才已经发生的事）
 *   node scripts/android-log.mjs --dump       # 只导最近 300 行就退出（发给别人看）
 *
 * 前置：手机「开发者选项 → USB 调试」已开，插线后手机上点「允许」。
 * 无线调试（Android 11+）：`adb pair 手机IP:配对端口 六位码` → `adb connect 手机IP:端口`。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = 'com.timing.app';
const TAG = 'Timing';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'release', 'logs');
const outFile = join(outDir, 'android-latest.log');

const args = new Set(process.argv.slice(2));
const keep = args.has('--keep');
const dump = args.has('--dump');

function findAdb() {
  const candidates = [];
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[key]) candidates.push(join(process.env[key], 'platform-tools', 'adb.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }
  candidates.push('adb');
  return candidates.find((path) => path === 'adb' || existsSync(path)) ?? 'adb';
}

const adb = findAdb();
const run = (cmd, list) => spawnSync(cmd, list, { encoding: 'utf8' });

/** 设备列表；多台时返回第一台在线的（并在屏幕上说明，避免抓错机器）。 */
function pickDevice() {
  const res = run(adb, ['devices']);
  if (res.error) {
    console.error(`找不到 adb：${res.error.message}`);
    console.error('装一个 Android SDK Platform-Tools，或把 ANDROID_HOME 指到 SDK 目录。');
    process.exit(1);
  }
  const lines = (res.stdout || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  const online = lines.filter((line) => line.endsWith('\tdevice'));
  lines
    .filter((line) => line.includes('unauthorized'))
    .forEach(() => console.error('手机还没授权：「始终允许使用这台计算机进行调试」勾上再点允许。'));
  if (online.length === 0) {
    console.error('没有在线设备。检查 USB 调试是否打开、数据线是否只充电不传数据。');
    process.exit(1);
  }
  if (online.length > 1) console.error(`连着 ${online.length} 台设备，用第一台：${online[0]}`);
  return online[0].split('\t')[0];
}

const serial = pickDevice();

/** App 进程 pid；没起来就返回 null（用户可能还没打开 App）。 */
function appPid() {
  const res = run(adb, ['-s', serial, 'shell', 'pidof', PKG]);
  const pid = (res.stdout || '').trim();
  return pid && /^\d+$/.test(pid) ? pid : null;
}

if (!keep && !dump) run(adb, ['-s', serial, 'logcat', '-c']);
mkdirSync(outDir, { recursive: true });

const pid = appPid();
if (!pid) {
  console.error(`没找到 ${PKG} 在运行——先在手机上把 Timing 打开，再重跑这个脚本。`);
  process.exit(1);
}
console.error(`设备 ${serial} · 进程 ${pid} · 日志同时写入 ${outFile}`);
if (dump) console.error('导出最近 300 行后退出…');

/* `*:S` 把其余 tag 全部压掉：桌面 logcat 里每秒都有几百行噪音，只看自己的。 */
const filters = [`${TAG}:V`, 'AndroidRuntime:E', 'DEBUG:V', 'libc:F', '*:S'];
const list = ['-s', serial, 'logcat', '-v', 'time', ...filters, '--pid', pid];
if (dump) list.push('-d', '-t', '300');

const child = spawn(adb, list, { stdio: ['ignore', 'pipe', 'inherit'] });
const file = createWriteStream(outFile, { flags: 'w' });
child.stdout.pipe(process.stdout);
child.stdout.pipe(file);

const stop = () => {
  child.kill();
  file.end();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', () => {
  file.end();
  process.exit(0);
});
