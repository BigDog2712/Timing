#!/usr/bin/env node
/**
 * Timing — 门禁接线自检（`scripts` / `check` 链 / `verify` / `ci.yml` 四处不许漂）
 * -----------------------------------------------------------------------------
 * ## 为什么需要它
 *
 * 本仓的门禁是**一串名字**：`package.json` 里定义 `check:xxx`，`check` 命令串里把它
 * 串起来，`.github/workflows/ci.yml` 里再逐步列一遍。这三处之间没有任何编译期或
 * 运行期约束，漂移的症状全部是**静默的**：
 *
 *   · 写了 `check:storage-keys` 但忘了加进 `check` 链 ⇒ 本地永远不跑它，输出仍然全绿；
 *   · 加进了 `check` 链但忘了加进 `ci.yml` ⇒ 本地绿、CI 根本不执行，
 *     而「CI 绿」被当成验收证据（本仓 2026-11 实测过：CI 连续 6 次红在构建步，
 *     同一件事本地 9 步全绿，因为那一步压根不在本地链里）；
 *   · 链里写了个已删除的脚本名 ⇒ `npm run check` 直接报 missing script，
 *     但只在那一步才报，前面几步的耗时已经花掉了；
 *   · 谁把 `verify` 里的 `test` 「优化」掉 ⇒ 验证只跑门禁不跑测试，而 `verify`
 *     这个名字仍然暗示「都验过了」。
 *
 * 这四种都是**名字层面的**错，用名字比对就能全部抓住，不需要解析代码。
 *
 * ## 判据（五条）
 *
 *   A `scripts` 里每个 `check:*` 都必须出现在 `check` 命令串里（抓「写了脚本没接进链」）
 *   B `check` 命令串里每个 `npm run X` 都必须在 `scripts` 里有定义（抓「链里引用了不存在的脚本」）
 *   C `verify` 必须同时引用 `check` 与 `test`（防将来把 test 优化掉）
 *   D `ci.yml` 里每个 `npm run X` 都必须在 `scripts` 里有定义（抓「CI 调了不存在的脚本」）
 *   E `scripts` 里每个 `check:*` 都必须在 `ci.yml` 里被执行（或有一个显式登记的等价物）
 *     —— 这条就是「新门禁必须接进 CI 且并集对齐」。没有它，A 只保证本地跑，
 *     CI 仍然可能是本地链的真子集，而 CI 才是唯一在干净环境里跑的判据面。
 *
 * **一个计数常量都不写死**：全部从 `package.json` 与 `ci.yml` 现算。写死数量的门禁
 * 每次新增脚本都要同批改判据，而「新增忘了改门禁」正是它要防的事。
 *
 * ## 自我防伪
 *
 * 末尾打印四处各自的引用数。任一为 0 即失败 —— 正则失配、YAML 缩进变了、字段改名，
 * 都会让规则安静地不再命中而输出依旧「全部通过」。**命中 0 处是目标，数到 0 个单元是事故**：
 * 这里每个数都是「数到了多少个单元」，没有一个可以为 0。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pkg = JSON.parse(read('package.json'));
/** @type {Record<string, string>} */
const scripts = pkg.scripts ?? {};
const chain = scripts.check ?? '';
const verify = scripts.verify ?? '';
const ciYaml = read('.github/workflows/ci.yml');

/** `npm run X` 的 X。`npm ci` / `npm install` 不匹配（它们不是脚本名）。 */
const npmRunRefs = (text) => [...text.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_.-]+)/g)].map((m) => m[1]);

/** `npm test` 这类 npm 内置别名形式。`npm run test` 走上面那条，不重复计。 */
const npmAliasRefs = (text) =>
  [...text.matchAll(/\bnpm\s+(test|start|stop|restart)\b/g)].map((m) => m[1]);

/** 把一处文本里的脚本引用全取出来（去重）。 */
const refsOf = (text) => new Set([...npmRunRefs(text), ...npmAliasRefs(text)]);

/**
 * 从 workflow YAML 里取所有 `run:` 的命令体。
 *
 * 只认两种形态：`run: <单行>` 与 `run: >` / `run: |`（块标量）。本仓的 clippy 步骤用的
 * 就是块标量，只解析单行会漏掉它，而「漏掉」的表现是**更绿**，看输出看不出来。
 * 不引入 YAML 解析器：多一个依赖只为读四个字符，且解析失败时的报错比这里更难读。
 */
function ciRunCommands(yaml) {
  const lines = yaml.split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const rest = m[2].trim().replace(/^["']|["']$/g, '');
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const block = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '') continue;
        if (lines[j].search(/\S/) <= indent) break;
        block.push(lines[j].trim());
        i = j;
      }
      out.push(block.join(' '));
    } else if (rest !== '') {
      out.push(rest);
    }
  }
  return out;
}

const ciCommands = ciRunCommands(ciYaml);
const ciRefs = new Set();
for (const cmd of ciCommands) for (const ref of refsOf(cmd)) ciRefs.add(ref);

/**
 * 「CI 用另一个脚本覆盖了某个 check 脚本」的显式登记表。
 * 目前只有一项：`npm run build` = `tsc && vite build`，在构建这一层是 `check:build`
 * （`vite build`）的**超集**，所以 CI 不需要再单独跑一次 `vite build`（那会白等一轮）。
 * 这张表必须保持极小，且每条都要写清「为什么是超集」——它是本门禁唯一的豁免口，
 * 而豁免口越大，"并集对齐"这句话就越没有内容。
 */
const CI_EQUIVALENTS = new Map([['check:build', 'build']]);

const checkStars = Object.keys(scripts).filter((name) => name.startsWith('check:'));
const chainRefs = refsOf(chain);
const verifyRefs = refsOf(verify);

const failures = [];

/* A · 写了脚本没接进链 */
const notInChain = checkStars.filter((name) => !chainRefs.has(name)).sort();
if (notInChain.length > 0) {
  failures.push({
    label: '定义了 check:* 但没接进 `check` 链（本地永远不跑它）',
    items: notInChain,
    hint: '把它加进 package.json 的 check 命令串；单独立一条脚本而不接链 = 一个没人执行的规则',
  });
}

/* B · 链里引用了不存在的脚本 */
const missingInScripts = [...chainRefs].filter((name) => !(name in scripts)).sort();
if (missingInScripts.length > 0) {
  failures.push({
    label: '`check` 链引用了 scripts 里不存在的脚本',
    items: missingInScripts,
    hint: '`npm run check` 会在这里报 missing script；脚本改名后必须同批改链',
  });
}

/* C · verify 必须同时跑门禁与测试 */
const verifyMissing = ['check', 'test'].filter((name) => !verifyRefs.has(name));
if (verifyMissing.length > 0) {
  failures.push({
    label: '`verify` 没有同时包含 check 与 test',
    items: verifyMissing.map((n) => `缺少 ${n}`),
    hint: 'verify 的语义是「门禁 + 测试都验过」；少一半而名字不变，等于让这个名字说谎',
  });
}

/* D · CI 调了不存在的脚本 */
const ciMissing = [...ciRefs].filter((name) => !(name in scripts)).sort();
if (ciMissing.length > 0) {
  failures.push({
    label: 'ci.yml 引用了 scripts 里不存在的脚本',
    items: ciMissing,
    hint: 'CI 会以 "Missing script" 失败；脚本改名后必须同批改 workflow',
  });
}

/* E · 新门禁必须接进 CI（并集对齐） */
const notInCi = checkStars
  .filter((name) => !ciRefs.has(name) && !ciRefs.has(CI_EQUIVALENTS.get(name)))
  .sort();
if (notInCi.length > 0) {
  failures.push({
    label: 'check:* 没有在 ci.yml 里执行（本地跑、CI 不跑）',
    items: notInCi.map((n) => (CI_EQUIVALENTS.has(n) ? `${n}（等价物 ${CI_EQUIVALENTS.get(n)} 也不在）` : n)),
    hint: '把它加成 ci.yml 的一步；本地绿不能当验收证据，CI 才是唯一在干净环境里跑的判据面',
  });
}

/* ── 自我防伪：每个数都是「数到了多少个单元」，一个都不许为 0 ─────────────── */
const units = [
  ['scripts 里的 check:* 脚本数', checkStars.length],
  ['`check` 链引用到的脚本数', chainRefs.size],
  ['`verify` 引用到的脚本数', verifyRefs.size],
  ['ci.yml 里解析到的脚本引用数', ciRefs.size],
];
const idle = units.filter(([, n]) => n === 0);
if (idle.length > 0) {
  failures.push({
    label: '被扫描单元数为 0（判据在空转）',
    items: idle.map(([name]) => `${name} = 0`),
    hint: '正则失配 / YAML 缩进变了 / 字段改名都会让规则安静地不再命中，而输出仍是「通过」',
  });
}

const summary =
  `check:* ${checkStars.length} 个 · check 链引用 ${chainRefs.size} 个 · ` +
  `verify 引用 ${verifyRefs.size} 个 · ci.yml run 步骤 ${ciCommands.length} 条（脚本引用 ${ciRefs.size} 个） · ` +
  `CI 等价物豁免 ${CI_EQUIVALENTS.size} 条`;

if (failures.length === 0) {
  console.log(`[ci-parity] OK — ${summary}`);
  process.exit(0);
}

console.error(`[ci-parity] FAILED — 门禁接线不一致：${summary}\n`);
for (const f of failures) {
  console.error(`✗ ${f.label}`);
  for (const item of f.items) console.error(`  缺少/异常: ${item}`);
  console.error(`  规则: ${f.hint}`);
}
process.exit(1);
