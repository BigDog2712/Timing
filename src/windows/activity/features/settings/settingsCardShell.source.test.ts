/**
 * 设置页网格里的每个块都得自带卡壳（[B5g]）
 * -----------------------------------------------------------------------------
 * 这条判据守的是**同一台机器的第三次事故**（前两次：B5c 的「把手绑定」拿不到宿主令牌、
 * B5f 的插件卡既不是卡也拿不到令牌）。共同根因只有一句：
 * 那些块是照**主窗**形状写的 —— 主窗里外壳由 `mobile/SettingsPage` 的页签容器提供，
 * 组件自己只有一个 `.foo` 的裸 `div`。搬到分析窗后父级外壳没跟过来，于是它在网格里
 * 成了一个悬空块（没底色 / 没圆角 / 没内边距 / 没标题），四周全是卡。
 *
 * `HostGeneralPanel` 是第三例：B5d-IA 把「最短记录时长」搬走后，它只剩「开机自启」一行，
 * 而根仍是一个 `.setting-group`（`display:flex; flex-direction:column`）—— 用户点导航
 * 「通用」跳过来，看到的是一张不存在的卡。
 *
 * ## 为什么清单是**写死**的
 * 因为这 11 个不是"所有组件"，而是"**渲染进设置页网格的那 11 个块**"（12 个锚点里剩下的
 * 第 12 个是 `s-pill-handles`，它的卡壳由 `FoldBlock standalone` 自带，见 g02）。
 * 这两件事不一样：「所有组件都要卡壳」是错的（行组件、对话框、卡片内部的小块都不该是卡）。
 * 所以清单只能手工维护 —— **加一个新的网格块时，往 `CARDED_BLOCKS` 里加一行**，
 * 这就是评审时要看的那一眼。清单腐化（写了个不存在的文件名）会被 g01 的第一段挡住。
 *
 * ## 判据口径
 * "根元素"= 导出组件里**某个 `return (` 后面紧跟的第一个元素**。为什么允许"某个"而不是
 * "第一个"：`HostPillLookCard` 在组件内部又定义了子组件（`Appearance`）、`HostPluginsPanel`
 * 里每个插件项也是一个 `return <li>` —— 拿"第一个 return"会把子组件的根当成卡片根。
 * 折中成：**至少一个、且只有一个** `return` 的根元素是卡。这既挡住了"根本没有卡壳"，
 * 也挡住了"到处乱加 at-panel"。
 *
 * 变异自证（真做过，见 B5g 报告）：
 *   · 删掉 `HostGeneralPanel` 根上的 `at-panel` → g01 红并点名该文件；
 *   · 把清单里任一文件名改成不存在的 → g01 也红（清单腐化检测）。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { existsSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { resolve } from 'node:path';

import { PROJECT_ROOT, code } from './settingsSourceProbe.test-utils';

/**
 * 渲染进设置页网格的 11 个块（按页序）。**加新块就往这里加一行。**
 * 第 12 个锚点 `s-pill-handles` 不走这条：它的卡壳由 `FoldBlock standalone` 提供（g02）。
 */
const CARDED_BLOCKS = [
  { anchor: 's-tracking', file: 'components/SettingsTrackingPanel.tsx' },
  { anchor: 's-display · 主题卡', file: 'components/host/HostThemeCard.tsx' },
  { anchor: 's-display · 高亮卡', file: 'components/host/HostHighlightCard.tsx' },
  { anchor: 's-display', file: 'components/SettingsAppearancePanel.tsx' },
  { anchor: 's-display · 常驻形态卡', file: 'components/host/HostPillLookCard.tsx' },
  { anchor: 's-sync', file: 'components/host/HostSyncPanel.tsx' },
  { anchor: 's-backup', file: 'components/SettingsDataSafetyPanel.tsx' },
  { anchor: 's-resident', file: 'components/SettingsResidentPanel.tsx' },
  { anchor: 's-plugins', file: 'components/host/HostPluginsPanel.tsx' },
  { anchor: 's-ai', file: 'components/host/HostAiCard.tsx' },
  { anchor: 's-general', file: 'components/host/HostGeneralPanel.tsx' },
] as const;

const SETTINGS_DIR = 'src/windows/activity/features/settings';

/** 导出组件里每个 `return (` 紧跟的根元素：`{ tag, classes }` */
function cardRootsOf(source: string): { tag: string; classes: string[] }[] {
  const exports = [...source.matchAll(/export\s+(?:default\s+)?function\s+\w+/g)];
  const from = exports.length > 0 ? exports[exports.length - 1].index! : 0;
  const body = source.slice(from);
  const roots: { tag: string; classes: string[] }[] = [];
  /* 允许 `return (<> …`（`SettingsDataSafetyPanel` 的卡外套了一层 Fragment：卡 + 四个对话框），
     Fragment 本身没有 className，所以跳过它取里面第一个元素。 */
  for (const m of body.matchAll(/return \(\s*(?:<>\s*)?<([a-z]+)\b[^>]*?className="([^"]*)"/g)) {
    roots.push({ tag: m[1], classes: m[2].split(/\s+/).filter(Boolean) });
  }
  return roots;
}

describe('设置页网格的卡壳', () => {
  it('g01_every_grid_block_brings_its_own_card_shell', () => {
    /* 清单腐化检测：文件名写错的话 `code()` 会抛 ENOENT，红的是一句看不懂的栈；
       先在这里显式断言存在，红的时候直接点名是哪一行写错了。 */
    for (const block of CARDED_BLOCKS) {
      expect(
        existsSync(resolve(PROJECT_ROOT, SETTINGS_DIR, block.file)),
        `清单里的文件不存在：${block.file}（${block.anchor}）—— 改名了就同步改这一行`,
      ).toBe(true);
    }
    /* 数量钉住：删掉一行也要显式改这里，别让清单悄悄缩水 */
    expect(CARDED_BLOCKS).toHaveLength(11);

    for (const block of CARDED_BLOCKS) {
      const roots = cardRootsOf(code(`${SETTINGS_DIR}/${block.file}`));
      const cards = roots.filter((root) => root.classes.includes('at-panel'));
      expect(
        cards.length,
        `${block.file}（锚点 ${block.anchor}）里找不到"根元素带 at-panel 的 return"：\n` +
          `  拿到的 return 根元素：${roots.map((r) => `${r.tag}.${r.classes.join('.')}`).join(' | ') || '（一个都没有）'}\n` +
          '  没有 at-panel = 它在网格里不是卡（没底色 / 圆角 / 内边距），四周全是卡。',
      ).toBe(1);
      /* 与同页其它卡同一档外壳内边距（`p-5 md:p-6`） */
      expect(cards[0].classes, `${block.file} 的卡壳缺 p-5`).toContain('p-5');
      expect(cards[0].classes, `${block.file} 的卡壳缺 md:p-6`).toContain('md:p-6');
    }
  });

  it('g02_the_handles_block_gets_its_shell_from_fold_block_standalone', () => {
    const handles = code(`${SETTINGS_DIR}/components/SettingsHandlesPanel.tsx`);
    /* 第 12 个锚点 `s-pill-handles` 不用 section：它自带卡壳的形态是 `FoldBlock standalone` */
    expect(handles, '「把手绑定」应当用 standalone 的 FoldBlock 当卡').toMatch(/<FoldBlock[\s\S]{0,200}?standalone/);
    const dataCss = code('src/windows/activity/shell/styles/features/host/settings-data.css');
    const start = dataCss.indexOf('.data__block--standalone {');
    expect(start, '找不到 `.data__block--standalone`：顶层卡壳的材质定义没了').toBeGreaterThan(-1);
    const block = dataCss.slice(start, dataCss.indexOf('}', start));
    /* 顶层那一档必须与 `at-panel` 同材质（面板底色 / 面板圆角），不是嵌套小卡那档 */
    expect(block).toContain('background: var(--at-bg-panel)');
    expect(block).toContain('border-radius: var(--at-radius-panel)');
    expect(block).toContain('border: 1px solid var(--at-border-subtle)');
  });
});
