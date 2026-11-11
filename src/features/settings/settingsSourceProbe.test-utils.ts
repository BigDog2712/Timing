/**
 * 源码级判据的**共用探针**（[0.12.1] T04b 从 `settingsConvergence.source.test.ts` 抽出）
 * -----------------------------------------------------------------------------
 * 为什么抽出来：T04b 之后判据分成两组（「归属/口径」与「五组锚点」），两组都要
 * 「读源码、去注释、按仓库根相对路径取文件」这套动作。复制一份等于把
 * `stripComments` 的正则维护成两处，早晚会出现「一处去注释、一处没去」的假绿。
 *
 * 为什么落在 `src/` 而不是 `tests/`：项目没有 `tests/` 目录，vitest 的 include 是
 * `src/**\/*.test.{ts,tsx}`，所以以 `.test-utils.ts` 结尾的文件**不会被当成用例收集**，
 * 但会被 `tsc` 一起类型检查 —— 正是我们要的（探针自己写错也要红）。
 *
 * ⚠️ 读文件的坑（上一版整份红在这里，记下来免得再踩）：
 * 不要写 `new URL('<字面量>', import.meta.url)`——Vite 的 `new URL(..., import.meta.url)`
 * 资源转换会在**构建期**把那个字面量改写成 `http://localhost:3000/@fs/...`，
 * 于是 `readFileSync` 收到一个 http URL，抛 `TypeError: The URL must be of scheme file`。
 * 所以这里一律 `fileURLToPath` + `path.resolve`，并且所有业务路径都以**仓库根**为基准、
 * 不写 `../../..` 那串靠层级数数的相对路径。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readdirSync, readFileSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { dirname, resolve } from 'node:path';
// @ts-expect-error 同上：仅测试进程用得到 node:url。
import { fileURLToPath } from 'node:url';

/** 仓库根 = 本文件所在目录往上 3 层（src/features/settings → 仓库根）。 */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 去掉注释——注释里正当地写着这些符号名，拿注释当证据会让用例变成「删注释就红」。 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 按**仓库根相对路径**读源码并去注释，例如 `src/features/settings/components/Settings.tsx`。 */
export function code(relFromRoot: string): string {
  return stripComments(readFileSync(resolve(PROJECT_ROOT, relFromRoot), 'utf8'));
}

/** 按仓库根相对路径读原文（JSON / toml 这类没有注释的文件用它，别用 `code()`）。 */
export function readRaw(relFromRoot: string): string {
  return readFileSync(resolve(PROJECT_ROOT, relFromRoot), 'utf8');
}

/** 递归列出目录下的 `.ts` / `.tsx`，跳过 `*.test.ts(x)`（测试自己不算证据）。 */
export function listSources(absDir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = resolve(absDir, entry.name);
    if (entry.isDirectory()) listSources(abs, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/**
 * 视图层三块：分析窗（features）/ 应用壳（app）/ 共用（shared）/ 宿主窗（components）。
 * IPC 与 services 层不在此列——`accent_set` 这类命令名本来就该出现在那里。
 */
export const VIEW_SOURCES = [
  'src/features',
  'src/app',
  'src/shared',
  'src/components',
].flatMap((rel) => listSources(resolve(PROJECT_ROOT, rel)));

/** 仓库根相对路径（统一正斜杠，Windows 下断言才不会因为 `\` 红）。 */
export function relFromRoot(abs: string): string {
  return abs.slice(PROJECT_ROOT.length + 1).replace(/\\/g, '/');
}

/** 在视图层里找出「仍然提到某段写主题/写主色代码」的文件（仓库根相对路径，已去注释）。 */
export function writersOf(needle: string): string[] {
  return VIEW_SOURCES
    .filter((abs) => stripComments(readFileSync(abs, 'utf8')).includes(needle))
    .map(relFromRoot);
}

/** 在视图层里找出「import 了某个模块」的文件（用 import 图钉住「谁能用这个控件」）。 */
export function importersOf(specifierFragment: string): string[] {
  return VIEW_SOURCES
    .filter((abs) => stripComments(readFileSync(abs, 'utf8')).includes(specifierFragment))
    .map(relFromRoot);
}

/**
 * 解析 `src-tauri/permissions/*.toml`：权限标识 → 它允许的命令集合。
 *
 * 为什么真解析而不是 grep 命令名：`theme_set` 这个串在注释里也出现（本仓库注释密度很高），
 * 直接 grep 会把「注释里提到」当成「真的授予了」—— 这正是 ACL 判据最容易假绿的地方。
 */
export function permissionGrants(): Map<string, Set<string>> {
  const dir = resolve(PROJECT_ROOT, 'src-tauri/permissions');
  const map = new Map<string, Set<string>>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.toml')) continue;
    const raw = readFileSync(resolve(dir, file), 'utf8');
    for (const block of raw.split('[[permission]]').slice(1)) {
      const id = block.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
      if (!id) continue;
      const allow = block.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
      map.set(id, new Set([...allow.matchAll(/"([^"]+)"/g)].map((match) => match[1])));
    }
  }
  return map;
}

/** 解析 `src-tauri/capabilities/*.json`：标识 / 覆盖的窗口 / 引用的权限。 */
export function capabilities(): { id: string; windows: readonly string[]; permissions: readonly string[] }[] {
  const dir = resolve(PROJECT_ROOT, 'src-tauri/capabilities');
  return readdirSync(dir)
    /* 显式 `string`：项目没装 @types/node，`readdirSync` 的回调参数会被推成 `any`，
       `noImplicitAny` 下直接红（这是本项目所有 node:fs 用法的统一处理方式）。 */
    .filter((file: string) => file.endsWith('.json'))
    .map((file: string) => {
      const json = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as {
        identifier?: string;
        windows?: string[];
        permissions?: string[];
      };
      return {
        id: json.identifier ?? file,
        windows: json.windows ?? [],
        permissions: json.permissions ?? [],
      };
    });
}

