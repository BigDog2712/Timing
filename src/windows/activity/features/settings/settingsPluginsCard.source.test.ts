/**
 * 插件卡：卡壳 + 令牌，两样都得自己带（[B5f]）
 * -----------------------------------------------------------------------------
 * 这一条只钉一个已经发生过的 bug，不做通用框架。
 *
 * 事故形状（和 B5c 的「把手绑定」、以及 `.num-field` 是同一台机器）：
 * `HostPluginsPanel` 是照**主窗**形状写的 —— 主窗 `PluginsTab` 的根也只是
 * `<div className="plg">`，卡片外壳由 `mobile/SettingsPage` 的页签容器提供。搬到分析窗后
 * 那层父级外壳没跟过来，于是同时缺两样：
 *   ① **卡**：没有 `at-panel` → 没底色、没圆角、没内边距；
 *   ② **令牌**：没有 `settings-host-sync` → `--line` / `--ink` / `--space-*` / `--radius-*`
 *      在分析窗里的**唯一**定义点就是那个桥（分析窗一条 `timing/styles/tokens/*` 都不引），
 *      于是 `.plg__item { border: 1px solid var(--line) }` 这类声明整条失效。
 * 这两件事肉眼看起来都像"材质和别处不一样"，所以很容易被当成设计取舍放过 —— 正是要一条
 * 判据盯住的原因。
 *
 * 注意：光给根加 `settings-host-sync` **不够**。`--btn-sm-h` 原来只定义在主窗
 * `01-primitives.css`，`--bg-field-hi` 只定义在主题层，桥里都没有 —— 所以 f2 把这两个值
 * 补进桥（补桥 = 保持单一真值；给每条规则抄 fallback = 同一份真值抄两遍，桥和 fallback
 * 迟早各长各的）。
 *
 * 变异自证（真做过，见 B5f 报告）：
 *   · 把根上的 `settings-host-sync` 删掉 → f01 红；
 *   · 把桥里的 `--btn-sm-h` 删掉 → f02 红（点名 `.plg__btn` 与 `--btn-sm-h`）。
 */
import { describe, expect, it } from 'vitest';

import { code } from './settingsSourceProbe.test-utils';

const PANEL_PATH = 'src/windows/activity/features/settings/components/host/HostPluginsPanel.tsx';
const PLUGINS_CSS_PATH = 'src/windows/activity/shell/styles/features/host/settings-plugins.css';
const BITS_CSS_PATH = 'src/windows/activity/shell/styles/features/host/settings-bits.css';
const GROUPS_PATH = 'src/windows/activity/features/settings/settingsGroups.ts';

/** `--at-*` / `--font-*` 在分析窗恒有定义（`tokens.css` 的 `@theme`），不算桥的依赖 */
const ALWAYS_DEFINED = /^--(at-|font-)/;

/** 桥里定义的自定义属性名（解析 `.settings-host-sync { … }` 那一个块，不是全文 grep） */
function bridgeTokens(): Set<string> {
  const css = code(BITS_CSS_PATH);
  const start = css.indexOf('.settings-host-sync {');
  if (start === -1) throw new Error('找不到 `.settings-host-sync` 桥块');
  const end = css.indexOf('\n}', start);
  if (end === -1) throw new Error('桥块没有闭合');
  const block = css.slice(start, end);
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** 某份 CSS 里"裸用"（= 没有 fallback）的自定义属性 → 用到它的选择器集合 */
function bareVarUses(css: string): Map<string, Set<string>> {
  const uses = new Map<string, Set<string>>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(css)) !== null) {
    const selector = rule[1].trim().replace(/\s+/g, ' ');
    for (const decl of rule[2].split(';')) {
      let at = 0;
      while ((at = decl.indexOf('var(', at)) !== -1) {
        let k = at + 4;
        let name = '';
        while (k < decl.length && !/[,)]/.test(decl[k])) { name += decl[k]; k += 1; }
        const hasFallback = decl[k] === ',';
        const trimmed = name.trim();
        if (!hasFallback && trimmed.startsWith('--') && !ALWAYS_DEFINED.test(trimmed)) {
          if (!uses.has(trimmed)) uses.set(trimmed, new Set());
          uses.get(trimmed)!.add(selector);
        }
        at += 4;
      }
    }
  }
  return uses;
}

describe('插件卡的卡壳与令牌', () => {
  it('f01_root_is_a_card_that_mounts_the_host_token_bridge', () => {
    const source = code(PANEL_PATH);
    const returnAt = source.indexOf('return (');
    expect(returnAt, '找不到 `return (`').toBeGreaterThan(-1);
    /* 根元素 = `return (` 之后的第一个 JSX 开标签 */
    const root = source.slice(returnAt).match(/<([a-z]+)\s+className="([^"]*)"/);
    expect(root, '根元素上没有 className').not.toBeNull();
    const [, tag, className] = root!;
    const classes = className.split(/\s+/);
    /* ① 是卡：与同页其它卡同一档外壳（`at-panel p-5 md:p-6`） */
    expect(tag, '根元素应当是 section（其余几块卡也是 section）').toBe('section');
    expect(classes, '缺 `at-panel`：这块就不是卡了（没底色/圆角/内边距）').toContain('at-panel');
    expect(classes, '缺 `md:p-6` 档的外壳内边距').toContain('p-5');
    /* ② 拿得到宿主令牌：桥是分析窗里 `--line` / `--ink*` / `--space-*` / `--radius-*` 的唯一来源 */
    expect(classes, '缺 `settings-host-sync`：`.plg__*` 里的裸 `var(--line)` 全部整条失效')
      .toContain('settings-host-sync');
    /* ③ `.plg` 块本身还在（标记一个字没改，只加了外面这层） */
    expect(source).toContain('<div className="plg">');
    /* ④ 标题与导航锚点逐字一致（通用规则：锚点 title 必须等于卡片 title） */
    expect(source).toContain('title="插件"');
    expect(code(GROUPS_PATH)).toContain('{ id: "s-plugins", title: "插件" }');
  });

  it('f02_every_bridge_only_token_used_by_the_plugin_card_is_defined_in_the_bridge', () => {
    const bridge = bridgeTokens();
    const uses = bareVarUses(code(PLUGINS_CSS_PATH));
    expect(uses.size, '没有量到任何裸变量（探针失效？）').toBeGreaterThan(0);
    const missing: string[] = [];
    for (const [name, selectors] of uses) {
      if (bridge.has(name)) continue;
      missing.push(`${[...selectors].join(' / ')} → ${name}`);
    }
    expect(
      missing,
      `插件卡挂在桥里，这些令牌桥里却没有定义，对应声明会整条失效：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('f03_bridge_keeps_the_two_values_it_used_to_lack', () => {
    const bridge = bridgeTokens();
    /* 这两个不是"随便补两个"：`--btn-sm-h` 原本只在主窗 primitives、`--bg-field-hi` 只在主题层。
       少任何一个，插件卡的按钮就退回 `.btn` 基础档（高度 30px / hover 不浮起）。 */
    expect(bridge.has('--btn-sm-h'), '桥里缺 `--btn-sm-h`（`.plg__btn` 的 height）').toBe(true);
    expect(bridge.has('--bg-field-hi'), '桥里缺 `--bg-field-hi`（`.btn--neutral:hover` 的底色）').toBe(true);
    /* 补在桥里而不是给规则加 fallback：桥里必须直接给值，不能转发到另一个也得靠桥的变量死循环 */
    expect(code(BITS_CSS_PATH)).toContain('--btn-sm-h: 24px;');
  });
});
