#!/usr/bin/env node
/**
 * Timing — IPC 契约自检（五处必须互相对齐）
 * -----------------------------------------------------------------------------
 * 命令侧（原有）：
 *   1. src-tauri/src/lib.rs        generate_handler![...] 注册的命令（snake_case）
 *   2. src/types/**                IpcApi 接口声明的方法（camelCase）
 *   3. src/services/ipc.ts         实际 invoke 的字符串 + 对象上的方法名
 *   4. src-tauri/src/error.rs      错误码字面值 ↔ 前端 ErrorCode 联合类型
 *
 * 事件与 mock（V0.3 扩充，见 ADR-015）：
 *   5. src-tauri/src/infra/events.rs 的事件名常量 ↔ 前端 IPC_EVENTS ↔ 实际 emit 点
 *      · 后端常量必须在前端声明（否则前端无从 listen）
 *      · 前端声明必须有 emit 来源（否则是死常量，只会在「监听永不触发」时浪费排查时间）
 *      · 禁止任何 `.emit("字面量")`：事件名只能来自 events.rs 常量
 *   6. src/mocks/** 的处理器键集合必须与 Rust 命令集合相等（浏览器 dev 不得缺口）
 *
 * 任何一处新增/删除而其余没跟上，`npm run check:contract` 都会非零退出。
 * 本脚本只认代码，不解析 Markdown（文档由人负责，机器保证代码自身闭合）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const toCamel = (snake) => snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

function walk(dir, ext, out = []) {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const p = join(full, name);
    if (statSync(p).isDirectory()) walk(join(dir, name), ext, out);
    else if (name.endsWith(ext)) out.push(join(dir, name));
  }
  return out;
}

/** 前端类型声明可能被拆到多个文件（types/domain/**），统一拼接后解析 */
function typesSource() {
  const files = ['src/types/domain.ts', ...walk('src/types/domain', '.ts')];
  return files.filter((f) => existsSync(join(root, f))).map(read).join('\n');
}

/** 1. Rust 注册的命令
 *
 * 命令表在 `src-tauri/src/ipc_commands.rs`（V0.12.0 融合 Patina 时从 `lib.rs` 拆出：
 * 宿主 79 条 + Patina 118 条，一张 `generate_handler!` 内）。这里只取**宿主**那一段
 * （`crate::commands::…`）——Patina 的命令由 `src/patina/**` 的前端自己调用，
 * 不进 `ipc.ts` / `IpcApi` / `browserMock` 这套宿主契约。
 */
function rustCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  if (!src.includes('generate_handler![')) {
    throw new Error('ipc_commands.rs 里找不到 generate_handler![...]');
  }
  return new Set([...src.matchAll(/crate::commands::\w+::(\w+)/g)].map((m) => m[1]));
}

/** Patina（vendored 子系统）注册的命令，仅用于「不许与宿主重名」这一条。 */
function patinaCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  return new Set([...src.matchAll(/crate::patina::commands::\w+::(\w+)/g)].map((m) => m[1]));
}

/** 2. IpcApi 接口方法 */
function apiMethods(types) {
  const start = types.indexOf('export interface IpcApi');
  if (start < 0) throw new Error('类型声明里找不到 IpcApi');
  const end = types.indexOf('\n}', start);
  if (end < 0) throw new Error('IpcApi 接口没有闭合');
  const block = types.slice(start, end);
  return new Set([...block.matchAll(/^ {2}([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]));
}

/** 3. ipc.ts 实际调用与对象方法 */
function ipcCalls() {
  const src = read('src/services/ipc.ts');
  const commands = new Set(
    [...src.matchAll(/call<[\s\S]{0,160}?>\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]),
  );
  const methods = new Set([...src.matchAll(/^ {2}([A-Za-z_]\w*):\s*\(/gm)].map((m) => m[1]));
  return { commands, methods };
}

/** 4. 错误码 */
function rustErrorCodes() {
  const src = read('src-tauri/src/error.rs');
  return new Set([...src.matchAll(/ErrorCode::\w+\s*=>\s*"([A-Z_]+)"/g)].map((m) => m[1]));
}

function apiErrorCodes(types) {
  const start = types.indexOf('export type ErrorCode');
  if (start < 0) throw new Error('类型声明里找不到 ErrorCode');
  const end = types.indexOf(';', start);
  return new Set([...types.slice(start, end).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
}

/** 事件常量文件可能在 app/ 或 infra/（v0.3 从 infra 迁到 app，见 ADR-016） */
function resolveEventFile() {
  const candidates = ['src-tauri/src/app/events.rs', 'src-tauri/src/infra/events.rs'];
  const found = candidates.find((p) => existsSync(join(root, p)));
  if (!found) throw new Error('找不到事件常量文件（app/events.rs 或 infra/events.rs）');
  return found;
}

/** 5. 事件：后端常量 / 前端声明 / 实际 emit 点 */
function rustEvents() {
  const src = read(resolveEventFile());
  /** 常量标识符 -> 事件值 */
  const map = new Map();
  for (const m of src.matchAll(/pub const (\w+): &str = "([^"]+)"/g)) map.set(m[1], m[2]);
  return { values: new Set(map.values()), byName: map };
}

function feEvents(types) {
  const start = types.indexOf('export const IPC_EVENTS');
  if (start < 0) throw new Error('类型声明里找不到 IPC_EVENTS');
  const end = types.indexOf('} as const', start);
  if (end < 0) throw new Error('IPC_EVENTS 没有闭合');
  return new Set([...types.slice(start, end).matchAll(/'([a-z][a-z0-9:-]+)'/gi)].map((m) => m[1]));
}

function emitSites(byName) {
  const files = walk('src-tauri/src', '.rs');
  /* vendored 子树（V0.12.0 融合的 Patina）自带一套事件名与常量，前端也在
     `src/patina/**` 里自用，不进宿主 `IPC_EVENTS`。它的 `.emit("字面量")` 属上游写法，
     不适用宿主 ADR-016 的「事件名只能来自 events.rs 常量」——改写 vendored 代码会让
     后续同步上游变成逐行冲突。**只豁免字面量这一条**，标识符计数仍全仓进行。 */
  const isVendored = (rel) => rel.replace(/\\/g, '/').includes('src-tauri/src/patina/');
  const values = new Set();
  const literals = [];
  const counts = new Map();
  for (const rel of files) {
    const src = read(rel);
    for (const [name] of byName) {
      const hits = src.match(new RegExp(`\\b${name}\\b`, 'g'));
      if (hits) counts.set(name, (counts.get(name) ?? 0) + hits.length);
    }
    // 直接 emit 的常量 / 字面量
    for (const m of src.matchAll(/\.emit\(\s*(&?)([A-Za-z_][\w:]*|"[^"]*")/g)) {
      const arg = m[2];
      if (arg.startsWith('"')) {
        if (!isVendored(rel)) literals.push(`${rel}: ${arg}`);
        values.add(arg.slice(1, -1));
        continue;
      }
      const ident = arg.split('::').pop();
      const value = byName.get(ident);
      // 动态变量（如 `name`）无法静态解析，按「已覆盖」处理：字面量检查已拦住硬编码
      if (value) values.add(value);
    }
  }
  /* 间接引用：事件名先存进变量再 emit（`emit_note_window` 这类多名称分发）。
     判据是「标识符出现 ≥2 次」= 声明 + 至少一次使用——只声明不用的仍是死常量。
     这条规则不区分使用点是否在 emit 上，宁宽勿漏：真正要防的是「前端监听了永不发生的事」。 */
  for (const [name, value] of byName) {
    if ((counts.get(name) ?? 0) > 1) values.add(value);
  }
  return { values, literals };
}

/** 6. mock 覆盖 */
function mockCommands() {
  const files = ['src/mocks/browserMock.ts', ...walk('src/mocks', '.ts').filter((f) => f.includes('browserMock'))];
  const keys = new Set();
  for (const rel of [...new Set(files)]) {
    if (!existsSync(join(root, rel))) continue;
    const src = read(rel);
    for (const m of src.matchAll(/^ {4}([a-z][a-z0-9_]*):\s*\(/gm)) keys.add(m[1]);
  }
  return keys;
}

const failures = [];
const check = (label, missing, extra, hint) => {
  if (missing.length === 0 && extra.length === 0) return;
  failures.push({ label, missing, extra, hint });
};

const types = typesSource();
const commands = rustCommands();
const patinaCmds = patinaCommands();
const api = apiMethods(types);
const { commands: calls, methods } = ipcCalls();

/* 宿主与 Patina 共用一张 `generate_handler!`：重名不会报错，**先注册的那份静默胜出**，
   另一边的命令永远调不到，且两端都没有日志（这类「装上了但没人响应」的故障最难查）。
   所以在这里钉死：两边命令名集合必须不相交。 */
check(
  '宿主与 Patina 的命令重名（先注册者静默胜出）',
  [...patinaCmds].filter((c) => commands.has(c)),
  [],
  '给其中一边的命令改名；两边共用一张命令表，重名不会被 Rust 或 Tauri 拦下',
);

check('Rust 注册了、前端没调用', diff(commands, calls), diff(calls, commands), 'ipc.ts 的 call() 与 ipc_commands.rs 的 handler 必须一一对应');
check('IpcApi 声明了、Rust 没注册', diff(api, new Set([...commands].map(toCamel))), diff(new Set([...commands].map(toCamel)), api), 'domain 的 IpcApi 与 ipc_commands.rs 必须一一对应');
check('ipc.ts 方法 与 IpcApi 不一致', diff(methods, api), diff(api, methods), 'ipc.ts 的实现对象必须实现 IpcApi 的每个方法');

const rustCodes = rustErrorCodes();
const feCodes = apiErrorCodes(types);
check('错误码两侧不一致', diff(rustCodes, feCodes), diff(feCodes, rustCodes), 'error.rs 的 as_str 与前端 ErrorCode 必须逐字一致');

/* 错误码 -> 文案覆盖：`errorText()` 的 switch 少一支不会报错，只会静默落到
   「操作失败，请稍后重试」。新加一个码却忘了给文案时，用户看到的就是这句万能兜底。
   这里要求每个 code 都有显式 case（文案内容不校验，那是产品文案的事）。 */
function errorTextCases() {
  const src = read('src/services/ipc.ts');
  const start = src.indexOf('export function errorText');
  if (start < 0) throw new Error('ipc.ts 里找不到 errorText()');
  const end = src.indexOf('\n}', start);
  const block = src.slice(start, end);
  return new Set([...block.matchAll(/case '([A-Z_]+)'/g)].map((m) => m[1]));
}
const textCodes = errorTextCases();
check(
  '错误码没有对应文案（会静默落到通用兜底）',
  diff(feCodes, textCodes),
  diff(textCodes, feCodes),
  'src/services/ipc.ts 的 errorText() 必须为每个 ErrorCode 提供一个 case',
);

/* ---- 事件 ---- */
const { values: rEvents, byName } = rustEvents();
const fEvents = feEvents(types);
const { values: emitted, literals } = emitSites(byName);

/* 允许「前端声明了、后端永不 emit」的事件：仅限被 feature 开关关掉的能力。
   新增条目必须写清原因与解锁条件，不允许用它掩盖拼写错误。
   [V0.3.3] 原唯一例外 `shortcut:triggered` 已随全局快捷键整体下架（ADR-022）删除，
   当前为空——**任何**前端声明都必须有真实 emit 点。 */
const EVENT_ALLOWLIST = new Map([]);

check(
  '后端 emit 的事件前端没声明',
  diff(rEvents, fEvents),
  [],
  'events.rs 的常量必须同步进前端 IPC_EVENTS，否则前端无从 listen',
);
check(
  '前端声明的事件后端没有来源（死常量）',
  diff(new Set([...fEvents].filter((e) => !emitted.has(e) && !EVENT_ALLOWLIST.has(e))), new Set()),
  [],
  'IPC_EVENTS 里每个事件都必须有 emit 点；临时停用的写进 check-contract.mjs 的 EVENT_ALLOWLIST',
);
if (literals.length) {
  failures.push({
    label: '存在硬编码的事件名字面量',
    missing: literals,
    extra: [],
    hint: '事件名只能来自 events.rs 常量；`.emit("字面量")` 一律改为 `.emit(CONST, ...)`',
  });
}

/* ---- mock 覆盖 ---- */
const mocks = mockCommands();
check(
  'Rust 有命令、浏览器 mock 没实现',
  diff(commands, mocks),
  diff(mocks, commands),
  'mocks 必须覆盖全部命令（浏览器 dev 与单测依赖它）；缺一条即红',
);

const summary = [
  `命令：Rust ${commands.size}（+Patina ${patinaCmds.size}）/ IpcApi ${api.size} / ipc.ts ${calls.size} / mock ${mocks.size}`,
  `错误码：Rust ${rustCodes.size} / 前端 ${feCodes.size}`,
  `事件：后端 ${rEvents.size} / 前端 ${fEvents.size} / emit 点 ${emitted.size}`,
].join('；');

if (failures.length === 0) {
  console.log(`[contract] OK — ${summary}`);
  process.exit(0);
}

console.error(`[contract] FAILED — ${summary}\n`);
for (const f of failures) {
  console.error(`✗ ${f.label}`);
  if (f.missing.length) console.error(`  缺少: ${f.missing.join(', ')}`);
  if (f.extra.length) console.error(`  多余: ${f.extra.join(', ')}`);
  console.error(`  规则: ${f.hint}`);
}
process.exit(1);
