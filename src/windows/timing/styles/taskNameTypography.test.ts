/**
 * Timing — 「新建入口」与「已显示事项名」的字号必须同一个令牌（V0.11.7 · QA 补测）
 * -----------------------------------------------------------------------------
 * 用户口径：「默认的新建事项字体与显示的事项字体不一致 应调整一致」。
 * 这次改动是**纯 CSS**，`check:brand` 只管色值、不管字号，所以字号对齐目前**零机械守卫**：
 * 谁把 `.pill__empty` 改回 `--text-body`，全部门禁照样绿，只有用户会再看见「点一下字变大」。
 *
 * 本文件读源 CSS 做**文本级**断言（jsdom 不加载外部样式表，拿不到 computed style）：
 * 只比对「两边取的是不是同一个令牌」，不写死 px 值 —— 令牌本身调整时不该红。
 *
 * 覆盖两处 v0.11.7 改过的入口，外加一处**本该一致但没改**的旁证（`.inline-text` 就地改名）。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上，
// `node:fs` 运行时可用。将来若有人补上 @types/node，这行会报「未使用的 @ts-expect-error」，
// 把注释删掉即可 —— 是有意的自愈信号，不是长期豁免。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读一份样式文件，去掉注释（注释里有 `font-size:` 字样，会污染解析） */
function css(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取某个选择器的声明块（必须精确到 `选择器 {`，不能吃到 `选择器,` 的分组选择器） */
function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!found) throw new Error(`找不到规则 ${selector}`);
  return found[1];
}

/** 取某一属性的声明值；没有该属性返回 undefined */
function decl(blockText: string, prop: string): string | undefined {
  const found = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`).exec(blockText);
  return found?.[1].trim();
}

describe('新建入口与事项名同字号（V0.11.7）', () => {
  const surfaces = css('./surfaces.css');
  const pillName = block(surfaces, '.pill__name');
  const pillEmpty = block(surfaces, '.pill__empty');

  it('小条：`.pill__empty` 的字号 / 字重与 `.pill__name` 取同一个令牌', () => {
    expect(decl(pillEmpty, 'font-size')).toBe(decl(pillName, 'font-size'));
    expect(decl(pillEmpty, 'font-weight')).toBe(decl(pillName, 'font-weight'));
    /* 两边都必须走令牌，不允许某一侧写死 px（否则「同一个令牌」这句话就没意义） */
    expect(decl(pillName, 'font-size')).toMatch(/^var\(--text-task-pill\)$/);
  });

  it('小条：占位入口仍是提示态颜色 `--ink-3`（只统一字号，不统一墨度）', () => {
    expect(decl(pillEmpty, 'color')).toBe('var(--ink-3)');
    expect(decl(pillName, 'color')).toBe('var(--ink)');
  });

  it('事项窗：「新增待办」输入框与它生成的那一行同字号', () => {
    /* 生成的是**待办行** `.todo-pend`，不是「今日计时」的 `.todo-row` —— 
       两者当前恰好都是 --text-sm，所以断言取待办行（真正会被这条输入影响的元素）。 */
    const compose = block(css('./todos-compose.css'), '.todos-compose__input');
    const pendTitle = block(css('./todos-pending.css'), '.todo-pend__title');
    expect(decl(compose, 'font-size')).toBe(decl(pendTitle, 'font-size'));
  });

  it('旁证：就地改名框 `.inline-text` 与两种行标题同字号（本次未改，确认没有第三处错位）', () => {
    const inline = block(css('./todos-inline.css'), '.inline-text');
    const pendTitle = block(css('./todos-pending.css'), '.todo-pend__title');
    const rowTitle = block(css('./todos-panel.css'), '.todo-row__title');
    expect(decl(inline, 'font-size')).toBe(decl(pendTitle, 'font-size'));
    expect(decl(inline, 'font-size')).toBe(decl(rowTitle, 'font-size'));
  });
});
