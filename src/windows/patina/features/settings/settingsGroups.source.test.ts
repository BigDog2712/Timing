/**
 * 设置页**五组锚点**的源码级判据（[0.12.1] T04b，从 `settingsConvergence.source.test.ts` 拆出）
 * -----------------------------------------------------------------------------
 * 原判据②说的是「分析窗设置分区 5 → 4」；T04b 之后这条被更强的说法替代了：
 * **设置只剩一个家（分析窗），家里有五组，每组的第一张卡一步可跳**。
 * 分区数不再是被优化的对象——可发现性才是。
 *
 * 五条判据：
 *   A. 五组、五个标题，且不再有独立的「外观」分区标题
 *   B. 表里每一个锚点 id 在页面上**恰好出现一次**（拼错 = 点了不滚也不报错）
 *   C. 锚点在页面里的**出现顺序** = 导航顺序（本文末尾的 `DOM_ORDER` 是唯一口径）
 *   D. 第一组是「悬浮条与手柄」，且它的第一张卡紧贴网格开头（第一屏可达）
 *   E. 「接口」仍然内嵌在「显示」卡里，不另起一张卡（P0-06 的既有结论不许被 T04b 推翻）
 */
import { describe, expect, it } from 'vitest';
import { code } from './settingsSourceProbe.test-utils';
import { SETTINGS_ANCHOR_IDS, SETTINGS_GROUPS } from './settingsGroups';

const SETTINGS = code('src/windows/patina/features/settings/components/Settings.tsx');
const APPEARANCE = code('src/windows/patina/features/settings/components/SettingsAppearancePanel.tsx');

/**
 * 锚点在页面源码里的**真实出现顺序**。
 * 它与 `SETTINGS_ANCHOR_IDS` 差一处，而且是**故意的**：`s-interface` 长在「显示」卡内部
 * （P0-06 把「接口」内嵌进「显示」，见判据 E），所以它出现在 `s-display` 之后、`s-tracking`
 * 之前，而表里它挂在「计时与记录」那一组（语义归属）。`s-board-widgets`（v3 组件板）
 * 是同一个形状的反面例子：它是**独立那张卡**，物理位置就在 `s-interface` 之后。这张表就是把「物理顺序」与
 * 「语义归属」两件事分开钉住——挪卡片的人必须同时改这两处，改一半就红。
 */
const DOM_ORDER = [
  's-pill-handles', 's-pill-look',
  's-theme', 's-highlight', 's-display', 's-interface', 's-board-widgets',
  's-tracking',
  's-sync', 's-backup',
  's-general', 's-resident', 's-plugins',
];

/** 按出现下标抠出 `id="s-…"`，得到页面上的锚点顺序。 */
function anchorsInSourceOrder(): string[] {
  const found: { id: string; at: number }[] = [];
  for (const match of SETTINGS.matchAll(/id="(s-[a-z-]+)"/g)) {
    found.push({ id: match[1], at: match.index ?? 0 });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.id);
}

describe('② 五组锚点（P0-06 判据 2 的替代口径）', () => {
  it('p006_six_groups_and_no_standalone_appearance', () => {
    /* [v3] 第五组之后插入「主界面」（组件板）：分组从 5 变 6 是**功能变化**，
       所以这条断言同批改；下表仍是「表 = 页面 = 导航」三者的唯一口径。 */
    expect(SETTINGS_GROUPS.map((group) => group.id))
      .toEqual(['pill', 'appearance', 'board', 'tracking', 'data', 'general']);
    /* 标题是中文常量、不进 i18n（`contract.ts` 本轮零行余量）：所以文案本身要钉住，
       不然「改一个字」这种改动会静默溜过去。 */
    expect(SETTINGS_GROUPS.map((group) => group.title))
      .toEqual(['悬浮条与手柄', '外观与配色', '主界面', '计时与记录', '数据与同步', '通用与启动']);
    for (const group of SETTINGS_GROUPS) {
      expect(group.anchors.length, `${group.id} 组没有锚点`).toBeGreaterThan(0);
      for (const anchor of group.anchors) {
        expect(anchor.title.trim(), `${anchor.id} 没有标题`).not.toBe('');
      }
    }
    /* 导航真的挂在页面上（表对了但没渲染 = 用户看不到，这是最难发现的一种）。 */
    expect(SETTINGS).toContain('SettingsGroupNav');
    /* 「外观」这个词在这两页的**可见文案**里彻底消失（已并入「显示」/「主题与主色」）。 */
    expect(SETTINGS + APPEARANCE).not.toContain('外观');
  });

  it('p006_every_anchor_exists_exactly_once', () => {
    /* 一条指向不存在 id 的锚点：点上去既不滚也不报错——用户以为界面坏了，
       开发以为导航坏了。所以「表 ⊂ 页面」这件事必须逐条数出来。 */
    for (const anchorId of SETTINGS_ANCHOR_IDS) {
      const hits = SETTINGS.split(`id="${anchorId}"`).length - 1;
      expect(hits, `锚点 ${anchorId} 在 Settings.tsx 里出现了 ${hits} 次（应为 1）`).toBe(1);
    }
    /* 反向：页面上不该有「表外」的 `s-*` 锚点（多写的锚点没人跳，只是噪音）。 */
    expect(anchorsInSourceOrder().sort()).toEqual([...SETTINGS_ANCHOR_IDS].sort());
  });

  it('p006_anchor_dom_order_matches_the_page', () => {
    expect(anchorsInSourceOrder()).toEqual(DOM_ORDER);
  });

  it('p006_first_group_is_handles_and_reachable_on_first_screen', () => {
    /* PRD A-01 的可发现性：用户进设置页第一眼要能看到手柄绑定，而不是先滚三屏。
       「第一组 + 第一张卡」两个条件同时成立才算第一屏可达。 */
    expect(SETTINGS_GROUPS[0]?.id).toBe('pill');
    expect(SETTINGS_GROUPS[0]?.anchors[0]?.id).toBe('s-pill-handles');
    const gridAt = SETTINGS.indexOf('grid grid-cols-1 gap-4 md:gap-5');
    const firstCardAt = SETTINGS.indexOf('<SettingsHandlesPanel');
    expect(gridAt, '找不到卡片网格（选择器改了要同批改本条）').toBeGreaterThan(-1);
    expect(firstCardAt).toBeGreaterThan(gridAt);
    expect(SETTINGS.indexOf('id="s-pill-handles"')).toBeGreaterThan(firstCardAt);
    /* 网格开头到第一张卡之间不许夹别的卡片标签（否则「第一张」就不是它了）。 */
    expect(SETTINGS.slice(gridAt, firstCardAt)).not.toContain('<Host');
    expect(SETTINGS.slice(gridAt, firstCardAt)).not.toContain('<Settings');
  });

  it('p006_interface_section_is_embedded_not_a_card', () => {
    /* P0-06 的既有结论：接口内嵌进「显示」分区（不落卡片外壳），T04b 不改这条。
       锚点套在内嵌值的最外层，所以 `s-interface` 物理上长在「显示」卡里（见 DOM_ORDER 注释）。 */
    const embeddedProp = SETTINGS.match(/interfaceSection=\{\([\s\S]*?\n\s*\)\}/);
    expect(embeddedProp, '找不到 interfaceSection 的 JSX 值（「接口」应内嵌进「显示」分区）').not.toBeNull();
    expect(embeddedProp![0]).toContain('SettingsInterfacePanel');
    expect(embeddedProp![0]).toContain('id="s-interface"');
    /* 内嵌必须关掉卡片外壳，否则是「卡片套卡片」。 */
    expect(embeddedProp![0]).toContain('embedded');
    expect(code('src/windows/patina/features/settings/components/SettingsInterfacePanel.tsx'))
      .toContain('embedded ? "" : "qp-panel p-5 md:p-6"');
    /* 顶层不许再有独立的「接口」卡：整份源码里 `<SettingsInterfacePanel` 这个 JSX 标签
       只应出现一次，且那一次就在上面这个内嵌值里（import 行不算标签，所以数 `<` 前缀）。 */
    expect(SETTINGS.split('<SettingsInterfacePanel').length - 1).toBe(1);
    expect(SETTINGS.replace(embeddedProp![0], '')).not.toContain('<SettingsInterfacePanel');
  });
});
