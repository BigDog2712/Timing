/**
 * [B5c 修复] `FoldBlock` 的样式依赖必须在**桥外**也成立
 * -----------------------------------------------------------------------------
 * 这一条守的是一个真事故：`FoldBlock` 原来只被「数据与同步」的六块数据卡用，而那些卡都在
 * `.settings-host-sync { }`（`settings-bits.css` 的**宿主遗留令牌桥**）里面。B5c 把
 * 「把手绑定」也换成了 `FoldBlock`，它挂在第 3 组的网格里 —— **桥外**。
 *
 * `--line` / `--space-*` / `--text-*` / `--radius-*` / `--ink*` 这套令牌在分析窗里唯一的
 * 定义点就是那个桥（分析窗一条都没引 `timing/styles/tokens/*`）。CSS 变量解析不到时不是
 * 「继承父级」，而是**该声明在 computed-value 阶段无效 → 取初始值**：
 *   `border: 1px solid var(--line)` → `border: medium none`
 *   `border-radius` → `0`、`background` → `transparent`、`padding` → `0`
 * 于是那块变成一截没边框、没底色、圆角 0、内边距 0 的裸内容。它看起来像"材质和别处不同"，
 * 所以很容易被当成设计取舍放过 —— 这正是要一条判据盯着的原因。
 *
 * 判据不写死类名清单，而是**从 `FoldBlock.tsx` 的 `className` 里现推**：组件以后再加一个
 * 类名，这里自动跟上。然后扫分析窗整棵样式树，凡选择器命中这些类的规则，其 `var()` 必须
 * 带 fallback（`--at-*` 与 `--font-mono` 除外，它们在分析窗恒有定义）。
 *
 * 另一条：fallback 必须**等于桥里的值**。桥和 fallback 是同一份真值的两个出口，桥改了
 * fallback 不跟着改 = 桥内桥外开始各长各的，这种漂移肉眼看不出来。
 *
 * 变异自证（真做过）：把 `settings-data.css` 的 `.data__block` 改回 `var(--line)` →
 * fc01 立刻红并点名 `.data__block` 与 `--line`；还原后全绿。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readdirSync, readFileSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { resolve } from 'node:path';

import { PROJECT_ROOT, relFromRoot, stripComments } from './settingsSourceProbe.test-utils';

const FOLD = stripComments(
  readFileSync(
    resolve(PROJECT_ROOT, 'src/windows/activity/features/settings/components/host/FoldBlock.tsx'),
    'utf8',
  ),
);
const STYLE_ROOT = resolve(PROJECT_ROOT, 'src/windows/activity/shell/styles');

/** 分析窗里恒有定义、不需要 fallback 的令牌：patina 设计令牌 + 字体栈。 */
const ALWAYS_DEFINED = /^--(at-|font-mono$|font-sans$|font-display$)/;

/** `FoldBlock` 真正会命中的类名（从组件源码推，不手抄）。 */
const FOLD_CLASSES: string[] = [
  ...new Set(
    [...FOLD.matchAll(/className="([^"]+)"/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter(Boolean),
  ),
];

interface Rule {
  file: string;
  selector: string;
  body: string;
}

/** 分析窗样式树里的全部规则（`@media` 嵌套会被拆成外层壳 + 内层真规则，够用）。 */
function allRules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }) as {
    name: string;
    isDirectory: () => boolean;
  }[]) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) allRules(abs, out);
    else if (entry.name.endsWith('.css')) out.push(abs);
  }
  return out;
}

function rulesOf(absFile: string): Rule[] {
  const source = stripComments(readFileSync(absFile, 'utf8'));
  const file = relFromRoot(absFile);
  return source.split('}').map((chunk: string) => {
    const braceAt = chunk.lastIndexOf('{');
    if (braceAt < 0) return { file, selector: '', body: '' };
    /* 选择器取「上一个 `}` 之后 → 这个 `{` 之前」，这样嵌套 `@media` 里的规则也能对上 */
    const head = chunk.slice(0, braceAt);
    const lineStart = Math.max(head.lastIndexOf('}'), head.lastIndexOf(';')) + 1;
    return { file, selector: head.slice(lineStart).trim(), body: chunk.slice(braceAt + 1) };
  });
}

/** 从 `var` 这个词的位置取到配对的 `)`，返回括号内文（含顶层逗号分隔的 fallback）。 */
function varArgs(body: string, varAt: number): string {
  const open = body.indexOf('(', varAt); /* `var(` 的左括号，从这里开始算层级 */
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '(') depth += 1;
    else if (body[i] === ')') {
      depth -= 1;
      if (depth === 0) return body.slice(open + 1, i);
    }
  }
  return body.slice(open + 1);
}

function splitTopLevel(args: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '(') depth += 1;
    else if (args[i] === ')') depth -= 1;
    else if (args[i] === ',' && depth === 0) return [args.slice(0, i).trim(), args.slice(i + 1).trim()];
  }
  return [args.trim(), ''];
}

/** `settings-bits.css` 里 `.settings-host-sync { }` 那座桥的「令牌 → 值」。 */
function bridgeTokens(): Map<string, string> {
  const source = stripComments(
    readFileSync(resolve(STYLE_ROOT, 'features/host/settings-bits.css'), 'utf8'),
  );
  const at = source.indexOf('.settings-host-sync {');
  expect(at, '找不到宿主令牌桥 `.settings-host-sync { }`（改名了要同批改本判据）').toBeGreaterThan(-1);
  const block = source.slice(at, source.indexOf('}', at));
  return new Map(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const RULES: Rule[] = allRules(STYLE_ROOT).flatMap(rulesOf);
const BRIDGE = bridgeTokens();

describe('[B5c 修复] FoldBlock 的样式在令牌桥外也必须完整', () => {
  it('fc00_the_class_list_really_comes_from_the_component', () => {
    /* 前提自检：从组件里推断不出类名，下面两条就变成空转的绿。 */
    expect(FOLD_CLASSES.length, 'FoldBlock 的 className 一个都没抓到').toBeGreaterThan(4);
    for (const expected of ['data__block', 'data__body', 'sync__fold-btn']) {
      expect(FOLD_CLASSES, `FoldBlock 的类名清单里少了 ${expected}（判据会漏掉它的样式）`)
        .toContain(expected);
    }
  });

  it('fc01_every_var_used_by_fold_block_styles_carries_a_fallback', () => {
    const hits = FOLD_CLASSES.map((name) => new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`));
    const violations: string[] = [];
    for (const rule of RULES) {
      if (!hits.some((hit) => hit.test(rule.selector))) continue;
      for (let i = rule.body.indexOf('var('); i > -1; i = rule.body.indexOf('var(', i + 1)) {
        const [name, fallback] = splitTopLevel(varArgs(rule.body, i));
        if (ALWAYS_DEFINED.test(name)) continue;
        if (fallback) continue;
        violations.push(`${rule.file} → ${rule.selector} → ${name}`);
      }
    }
    expect(
      violations,
      '这些规则被桥外的「把手绑定」命中，但令牌在桥外没有定义：变量解析不到 = 整条声明取初始值'
        + '（border→none / radius→0 / background→transparent / padding→0）。给它们补上与桥同值的 fallback。',
    ).toEqual([]);
  });

  it('fc02_the_fallbacks_agree_with_the_bridge_so_the_six_data_cards_do_not_move', () => {
    /* 六块数据卡在桥内走的是桥的值 —— fallback 只在变量缺失时启用，所以只要两者同值，
       桥内视觉必然零变化。这条防的是「桥改了、fallback 没跟上」的静默漂移。 */
    const drift: string[] = [];
    const source = stripComments(
      readFileSync(resolve(STYLE_ROOT, 'features/host/settings-data.css'), 'utf8'),
    );
    for (let i = source.indexOf('var('); i > -1; i = source.indexOf('var(', i + 1)) {
      const [name, fallback] = splitTopLevel(varArgs(source, i));
      if (!fallback || ALWAYS_DEFINED.test(name)) continue;
      const bridged = BRIDGE.get(name);
      if (bridged === undefined) continue;
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      if (normalize(bridged) !== normalize(fallback)) {
        drift.push(`${name}: 桥=${bridged} / fallback=${fallback}`);
      }
    }
    expect(drift, 'fallback 与桥里的值不一致，桥内桥外会各长各的').toEqual([]);
    /* 反向自检：这条判据真的读到了东西 */
    expect(BRIDGE.get('--line')).toBe('var(--at-border-subtle)');
  });

  it('fc03_the_handles_card_shell_has_a_border_background_and_padding_outside_the_bridge', () => {
    /* 事故的具体形状：这一整块曾经是一截裸内容。逐条列出"桥外必须成立"的四个属性，
       红的时候能直接看出少的是哪个（fc01 只说"某个 var 没 fallback"）。 */
    const shell = RULES.find((rule) => rule.selector === '.data__block');
    expect(shell, '找不到 `.data__block` 规则（改名了要同批改本判据）').toBeTruthy();
    expect(shell?.body).toContain('border: 1px solid var(--line, var(--at-border-subtle))');
    expect(shell?.body).toContain('border-radius: var(--radius-md, 10px)');
    expect(shell?.body).toContain('background: var(--bg-field, var(--at-bg-elevated))');
    const head = RULES.find((rule) => rule.selector === '.data__block-head');
    expect(head?.body, '块头的内边距在桥外失效会让整块贴边').toContain('padding: var(--space-3, 12px)');
  });
});
