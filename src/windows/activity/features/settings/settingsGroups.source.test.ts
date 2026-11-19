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
 *   D. 第一组是「计时行为」，且它的第一张卡紧贴网格开头（第一屏可达）
 *   E. 「接口」那一族入口**不再存在**（[设置页七项改造·批 1] 整卡下线后的反向回归）
 *
 * [B5b] D 的口径换过一次：原先是「第一组是悬浮条与手柄」（0.12.1 给新功能配的
 * 可发现性口径），现在按使用场景重排、高频组进第一屏，第一组是「计时行为」。
 * 判据形状没变（仍是「第一组 + 第一张卡」两个条件），换了主语而已。
 */
import { describe, expect, it } from 'vitest';
import { code } from './settingsSourceProbe.test-utils';
import { SETTINGS_ANCHOR_IDS, SETTINGS_GROUPS } from './settingsGroups';

const SETTINGS = code('src/windows/activity/features/settings/components/Settings.tsx');
const APPEARANCE = code('src/windows/activity/features/settings/components/SettingsAppearancePanel.tsx');

/**
 * 锚点在页面源码里的**真实出现顺序**。它必须与 `SETTINGS_ANCHOR_IDS` 一致：
 * 语义归属与物理顺序在本轮已经收成一条（「接口」内嵌卡与「主界面组件」卡都下线了，
 * 不再有「挂在 A 组、长在 B 卡里」的形状）。这张表就是把「物理顺序」钉住——
 * 挪卡片的人必须同时改表与页面，改一半就红。
 */
const DOM_ORDER = [
  's-tracking',
  's-theme', 's-highlight', 's-display',
  's-pill-handles', 's-pill-look',
  's-sync', 's-backup',
  's-general', 's-resident', 's-plugins', 's-ai',
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
    /* [设置页七项改造·批 2] 「主界面」组随「主界面组件」卡一起下线：分组 6 → 5。
       这张表仍是「表 = 页面 = 导航」三者的唯一口径。 */
    expect(SETTINGS_GROUPS.map((group) => group.id))
      .toEqual(['tracking', 'appearance', 'pill', 'data', 'general']);
    /* 标题是中文常量、不进 i18n（`contract.ts` 本轮零行余量）：所以文案本身要钉住，
       不然「改一个字」这种改动会静默溜过去。[B5b] 三个组名按使用场景重命名：
       计时与记录 → 计时行为、外观与配色 → 外观与主题、悬浮条与手柄 → 悬浮条与把手
       （术语跟着锚点 title「把手绑定」走，别在同一页混用「手柄/把手」）。 */
    expect(SETTINGS_GROUPS.map((group) => group.title))
      .toEqual(['计时行为', '外观与主题', '悬浮条与把手', '数据与同步', '通用与启动']);
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

  it('p006_first_group_is_tracking_and_reachable_on_first_screen', () => {
    /* [B5b] 可发现性的主语换了：进设置页第一屏要看到的是**计时规则**（高频，每次调时长
       都碰），不是「把手绑定」（设置一次就不再动）。判据形状没变 —— 「第一组 + 第一张卡」
       两个条件同时成立才算第一屏可达。 */
    expect(SETTINGS_GROUPS[0]?.id).toBe('tracking');
    expect(SETTINGS_GROUPS[0]?.anchors[0]?.id).toBe('s-tracking');
    const gridAt = SETTINGS.indexOf('grid grid-cols-1 gap-4 md:gap-5');
    /* 第一张卡是包着 `SettingsTrackingPanel` 的 `div#s-tracking`（它不是组件，是锚点容器） */
    const firstCardAt = SETTINGS.indexOf('<div id="s-tracking"');
    expect(gridAt, '找不到卡片网格（选择器改了要同批改本条）').toBeGreaterThan(-1);
    expect(firstCardAt, '找不到第一张卡（锚点容器的写法改了要同批改本条）').toBeGreaterThan(gridAt);
    /* 网格开头到第一张卡之间不许夹别的卡片标签（否则「第一张」就不是它了）。 */
    expect(SETTINGS.slice(gridAt, firstCardAt)).not.toContain('<Host');
    expect(SETTINGS.slice(gridAt, firstCardAt)).not.toContain('<Settings');
  });

  it('p006_interface_section_is_gone', () => {
    /* [设置页七项改造·批 1] 「服务」面板（网页同步 / 远程推送）整卡下线：
       没有内嵌值、没有锚点、没有组件文件。这条回归的作用是**挡住入口复活**——
       功能被删了，但把卡片接回设置页只需要一次 import，没人会记得为什么删。 */
    expect(SETTINGS).not.toContain('interfaceSection');
    expect(SETTINGS).not.toContain('SettingsInterfacePanel');
    expect(SETTINGS).not.toContain('id="s-interface"');
    expect(SETTINGS_ANCHOR_IDS).not.toContain('s-interface');
    expect(() => code('src/windows/activity/features/settings/components/SettingsInterfacePanel.tsx')
    ).toThrow();
    /* 字段本身**保留**（后端与 `features/data` 仍在读 `webActivityEnabled`），
       所以这条不是「连 setting 一起删」，只钉界面入口。 */
    expect(SETTINGS).not.toContain('showWebActivityHelp');
  });
});
