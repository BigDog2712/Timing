#!/usr/bin/env node
/* 一次性迁移：把 src/ 按双窗结构重排（审计 2026-11-12 批 3）
 *
 * 为什么需要脚本：3366 条相对 import 不能靠字符串替换改 —— 相对路径随文件位置变化，
 * 必须逐条「按旧坐标解析 → 按新坐标重算」。仓库相对路径（配置/测试里的 'src/...'）才适用前缀替换。
 *
 * 用法：
 *   node scripts/oneoff/migrate-src-layout.mjs            # 干跑：只校验，不写盘
 *   node scripts/oneoff/migrate-src-layout.mjs --apply    # 执行（需先关 dev 会话 + 工作树干净）
 *
 * 回滚：git reset --hard <迁移前的提交>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');

const MAP = [
  // 全局类型声明：两个入口共用，留在 src/ 根不搬（tsconfig include: ["src"] 覆盖它）
  ['src/vite-env.d.ts', 'src/vite-env.d.ts'],
  ['src/main.tsx', 'src/windows/timing/entry/main.tsx'],
  ['src/App.tsx', 'src/windows/timing/entry/App.tsx'],
  ['src/app/', 'src/windows/patina/shell/'],
  ['src/features/', 'src/windows/patina/features/'],
  ['src/platform/', 'src/windows/patina/platform/'],
  ['src/shared/', 'src/windows/patina/shared/'],
  ['src/components/', 'src/windows/timing/components/'],
  ['src/hooks/', 'src/windows/timing/hooks/'],
  ['src/services/', 'src/windows/timing/services/'],
  ['src/stores/', 'src/windows/timing/stores/'],
  ['src/styles/', 'src/windows/timing/styles/'],
  ['src/types/', 'src/windows/timing/types/'],
  ['src/lib/', 'src/windows/timing/lib/'],
  ['src/mocks/', 'src/windows/timing/mocks/'],
];

const toPosix = (p) => p.split(path.sep).join('/');

function mapPath(rel) {
  let best = null;
  for (const [from, to] of MAP) {
    if (rel === from || rel.startsWith(from)) {
      if (!best || from.length > best[0].length) best = [from, to];
    }
  }
  return best ? best[1] + rel.slice(best[0].length) : null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(toPosix(path.relative(ROOT, abs)));
  }
  return out;
}

const oldFiles = walk(path.join(ROOT, 'src'));
const fileSet = new Set(oldFiles);
const newOf = new Map(oldFiles.map((f) => [f, mapPath(f)]));

const unmapped = oldFiles.filter((f) => !newOf.get(f));
if (unmapped.length) {
  console.error('[迁移] 以下文件不在映射表内，会漏搬：\n  ' + unmapped.join('\n  '));
  process.exit(1);
}

/** 相对说明符 → 旧坐标真实文件；解析不到返回 null */
function resolveOld(fromOldRel, spec) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromOldRel), spec));
  const cands = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.d.ts`,
    `${target}.css`,
    `${target}.json`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ];
  return cands.find((c) => fileSet.has(c)) ?? null;
}

/** 旧说明符 → 新说明符（保持"有无扩展名"与"是否 /index"的写法） */
function rewriteSpec(fromOldRel, spec) {
  const hit = resolveOld(fromOldRel, spec);
  if (!hit) return null;
  const newFrom = newOf.get(fromOldRel);
  const newTo = newOf.get(hit);
  let rel = path.posix.relative(path.posix.dirname(newFrom), newTo);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  const hadExt = /\.(tsx?|css|json)$/.test(spec) || /\.d\.ts$/.test(spec);
  const endedIndex = /\/index(\.tsx?)?$/.test(spec);
  if (!hadExt) rel = rel.replace(/\.(tsx?|css|json)$/, '');
  if (endedIndex && !/\/index(\.tsx?)?$/.test(rel)) rel = `${rel}/index`;
  return rel;
}

let importHits = 0;
let literalHits = 0;
const changed = [];
const unresolved = [];

for (const oldRel of oldFiles) {
  if (!/\.(ts|tsx|css)$/.test(oldRel)) continue;
  const before = readFileSync(path.join(ROOT, oldRel), 'utf8');
  let src = before;

  // ① 所有以 ./ 或 ../ 开头的字符串字面量：import / import() / require / css @import / 路径字面量
  src = src.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (m, q, spec) => {
    if (spec.includes('?')) return m; // ?raw / ?url 查询串后面单独处理
    const bare = spec.replace(/\?(.*)$/, '');
    const next = rewriteSpec(oldRel, bare);
    if (next === null) {
      /* 解析不到：分两种。
         (a) 目标在 src 之外（src-tauri、tests、仓库根）：文件一搬家，相对深度就变了，必须重算，
             否则 source-probe 测试与图标引用全会断；
         (b) 目标仍在 src 内：多是注释里的示意路径或已失效的旧引用，保持原样（改了反而凭空造出文件）。 */
      const outTarget = path.posix.normalize(
        path.posix.join(path.posix.dirname(oldRel), bare.replace(/\?(.*)$/, '')),
      );
      if (outTarget.startsWith('../') || !outTarget.startsWith('src/')) {
        const newFrom = newOf.get(oldRel);
        let rel = path.posix.relative(path.posix.dirname(newFrom), outTarget);
        if (!rel.startsWith('.')) rel = `./${rel}`;
        if (rel !== bare) {
          importHits += 1;
          return `${q}${rel}${q}`;
        }
        return m;
      }
      unresolved.push(`${oldRel}: ${spec}`);
      return m;
    }
    if (next === bare) return m;
    importHits += 1;
    return `${q}${next}${q}`;
  });

  // ② 仓库相对路径字面量（source-probe 测试与配置常量常用 'src/features/...'）
  src = src.replace(/(['"])(src\/(?!-tauri)[^'"\n]+)\1/g, (m, q, lit) => {
    const mapped = mapPath(lit);
    if (!mapped || mapped === lit) return m;
    literalHits += 1;
    return `${q}${mapped}${q}`;
  });

  if (src !== before) changed.push([oldRel, newOf.get(oldRel), src]);
}

console.log(`[迁移] src 文件 ${oldFiles.length} 个；需改内容 ${changed.length} 个`);
console.log(`[迁移] 相对说明符 ${importHits} 处、仓库相对字面量 ${literalHits} 处`);

const uniqUnresolved = [...new Set(unresolved)];
if (uniqUnresolved.length) {
  console.log(`[迁移] 未解析 ${uniqUnresolved.length} 处（多为注释/动态拼接/?raw，需人工过目）：`);
  uniqUnresolved.slice(0, 25).forEach((u) => console.log('   ' + u));
}

const seen = new Map();
for (const [, n] of newOf) seen.set(n, (seen.get(n) ?? 0) + 1);
const collisions = [...seen].filter(([, c]) => c > 1).map(([p]) => p);
if (collisions.length) {
  console.error('[迁移] 目标路径冲突：' + collisions.join(', '));
  process.exit(1);
}

if (!APPLY) {
  console.log('[迁移] 干跑结束（未写盘）。加 --apply 执行。');
  process.exit(0);
}

const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
if (dirty) {
  console.error('[迁移] 工作树不干净，拒绝执行：\n' + dirty);
  process.exit(1);
}

const dirs = new Set();
for (const [oldRel, newRel] of newOf) {
  const dir = path.posix.dirname(newRel);
  if (!dirs.has(dir)) {
    execSync(`mkdir -p "${dir}"`, { cwd: ROOT, shell: '/bin/bash' });
    dirs.add(dir);
  }
  execSync(`git mv "${oldRel}" "${newRel}"`, { cwd: ROOT });
}
for (const [, newRel, content] of changed) writeFileSync(path.join(ROOT, newRel), content, 'utf8');
try {
  execSync('find src -type d -empty -delete', { cwd: ROOT, shell: '/bin/bash' });
} catch {
  /* 清不掉无妨 */
}

console.log('[迁移] 已执行。接着必须跑：npx tsc --noEmit && npx eslint src && node scripts/check-layers.mjs && node scripts/check-size.mjs && npx vitest run');
console.log('[迁移] 再手工改配置：vite.config.ts / index.html / patina.html / scripts/*.mjs / scripts/*.json（前缀替换，勿碰 src-tauri/src/app）。');
