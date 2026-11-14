#!/usr/bin/env node
/**
 * Timing — 变异标记门禁（「注入必须可见、撤销必须可机检」的机械执行）
 * -----------------------------------------------------------------------------
 * 判据只有一条：`MUTATION`（全大写、左侧词边界）出现在源码里 → 红，并点名 文件:行。
 *
 * ## 为什么要这条门禁
 *
 * 变异自证（注入一处错误 → 看用例是否红 → 撤销）是本仓验收的固定动作，而它有一个
 * 靠记性挡不住的风险：**注入与撤销之间，磁盘状态与「故意为之」长得一模一样**。
 * 2026-11-14 一个下午出了三次同款：`if true ||`（`verify_copy` 恒返回 Ok）、
 * `&& false`（指针闸恒不成立）、`let _ = legacy_path;`（`recover_legacy` 一次都没调）。
 * 三次都能编译、都零告警、都对用例有真实影响，所以只能靠**与内容无关的约定**发现：
 * 注入那一行必须带 `MUTATION` 字样，门禁只扫它。
 *
 * ## 为什么不扫中文「变异」
 *
 * 仓里有大量「变异自检」的**正常**文档注释（`infra/md_webdav/remove.rs`、`daily.rs`、
 * `md_section.rs`……），它们长期说明「这里是用例的靶子」，扫到就是假阳性。所以只认
 * `MUTATION` 这个大写词：正常注释里不会出现它，出现就一定是注入。
 *
 * ## 这条门禁能证明什么、不能证明什么（别过度承诺）
 *
 * 它**不**证明用例有敏感性（那是变异自证本身的事，得靠「注入后必须红」那一段）。
 * 它只保证：即使你忘了撤，也不会有人把这份树当成干净树接受——忘记撤销的代价是门禁红，
 * 而不是静默交付一个死掉的判据。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* 只看源码：与 `check-size` 同一份扫描面，少一样东西就会漏掉一种注入。
   **不扫 `scripts/`**：本脚本自己的头注与提示文案里必须写 `MUTATION`，自扫必然自红。
   代价说清：往脚本里塞注入门禁抓不到——但脚本不是产品代码，注入在那儿跑不出用户可见行为。 */
const SCAN = ['src', 'src-tauri/src'];
const EXT = new Set(['.ts', '.tsx', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'gen']);
/* 全大写 `MUTATION`，**只在左边设词边界**。
 *
 * 右侧不设 `\b` 是有意的：`\b` 要求「词字符 / 非词字符」交界，而下划线**是词字符**，所以
 * `const MUTATION_FLAG = 1;` 里的 `MUTATION` 右边不成边界——`/\bMUTATION\b/` 会**恰好漏掉**
 * 「把开关命名成 MUTATION_FLAG / MUTATION_ENABLED」这种最像注入的写法（QA 实测：旧判据对它
 * 不命中）。右侧放开后 `MUTATION_SKIP`、`MUTATIONOFF` 也一并抓到——它们本来就是注入形态。
 *
 * 左侧的 `\b` 已经足以排除变量名里的偶然命中：`X_MUTATION` 因为下划线是词字符而不成边界，
 * 不命中。真出现那种写法宁可红一次，人看一眼就能判。
 *
 * 六种写法的实测口径：
 *   `// MUTATION: x`         → 命中（前一个字符是空格）
 *   `const MUTATION_FLAG`    → 命中（前一个是空格；右侧不设边界，`_` 不影响）
 *   `const MUTATION_SKIP`    → 命中（同上）
 *   `const MUTATIONOFF`      → 命中（右侧不设边界）
 *   `const SMUTATION`        → 不命中（前一个是字母 S，左侧无边界）
 *   `const X_MUTATION`       → 不命中（前一个是下划线，是词字符，左侧无边界）
 *   `// mutation: 小写`       → 不命中（大小写敏感，只认注入约定）
 */
const MARKER = /\bMUTATION/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (EXT.has(name.slice(name.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN.flatMap((dir) => walk(join(root, dir)));
const hits = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, index) => {
    if (MARKER.test(text)) {
      hits.push(`${relative(root, file).split(sep).join('/')}:${index + 1} — ${text.trim()}`);
    }
  });
}

if (hits.length === 0) {
  console.log(`[mutation] OK — 扫描 ${files.length} 个文件，MUTATION 标记 0 处`);
  process.exit(0);
}

console.error(`[mutation] FAILED — 扫描 ${files.length} 个文件，命中 ${hits.length} 处：\n`);
for (const hit of hits) console.error(`✗ ${hit}`);
console.error('\n规则：变异注入必须在那一行带 `MUTATION` 字样，撤销时连同标记一起删掉。');
console.error('不许用 `if true ||`、`&& false`、`let _ = x;` 这类「合法且零告警」的写法当开关——');
console.error('它们与正常代码长得一模一样，静态复核与门禁都只能靠这条约定发现。');
process.exit(1);
