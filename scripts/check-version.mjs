#!/usr/bin/env node
/**
 * TickBar — 版本号五处一致性门禁（AGENTS.md：版本号五处同步）
 * -----------------------------------------------------------------------------
 *   1. package.json            version
 *   2. package-lock.json       version + packages[""].version
 *   3. src-tauri/Cargo.toml    [package] version
 *   4. src-tauri/Cargo.lock    name = "tickbar" 那条的 version
 *   5. src-tauri/tauri.conf.json  version
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function packageJson() {
  return JSON.parse(read('package.json')).version;
}

function packageLock() {
  const lock = JSON.parse(read('package-lock.json'));
  return { top: lock.version, root: lock.packages?.['']?.version };
}

function cargoToml() {
  const src = read('src-tauri/Cargo.toml');
  const pkg = src.slice(src.indexOf('[package]'));
  const m = pkg.match(/^version\s*=\s*"([^"]+)"/m);
  return m?.[1];
}

function cargoLock() {
  const src = read('src-tauri/Cargo.lock');
  // 只取 name = "tickbar" 这个 package 段
  const blocks = src.split('[[package]]');
  for (const b of blocks) {
    if (/name\s*=\s*"tickbar"/.test(b)) {
      const m = b.match(/version\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return undefined;
}

function tauriConf() {
  return JSON.parse(read('src-tauri/tauri.conf.json')).version;
}

const entries = [
  ['package.json', packageJson()],
  ['package-lock.json (version)', packageLock().top],
  ['package-lock.json (packages[""])', packageLock().root],
  ['src-tauri/Cargo.toml', cargoToml()],
  ['src-tauri/Cargo.lock', cargoLock()],
  ['src-tauri/tauri.conf.json', tauriConf()],
];

const missing = entries.filter(([, v]) => !v);
const values = new Set(entries.map(([, v]) => v).filter(Boolean));

if (missing.length || values.size !== 1) {
  console.error('[version] FAILED — 版本号不一致\n');
  for (const [file, v] of entries) console.error(`  ${v ? ' ' : '?'} ${file.padEnd(36)} ${v ?? '（未解析到）'}`);
  console.error(`\n规则：五处必须同为同一 MAJOR.MINOR.PATCH（AGENTS.md）；改版时一起改，并写 CHANGELOG.md。`);
  process.exit(1);
}

console.log(`[version] OK — ${[...values][0]}（六处口径一致）`);
