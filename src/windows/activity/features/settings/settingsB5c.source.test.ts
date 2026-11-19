/**
 * [B5c] 结构级判据：把手绑定折进高级区 + 开机自启只剩一个入口
 * -----------------------------------------------------------------------------
 * 这一批改的两件事都有"改回去也照样跑"的形状，所以各要一条**结构**判据：
 *
 *   ① 折叠块的**锚点必须挂在可见头部**。`FoldBlock` 的折叠体是 `hidden` 的，锚点要是落在
 *      体里，导航点上去既不滚也不报错（`scrollIntoView` 对隐藏元素静默失效）——
 *      这类错误跑起来完全看不出来，只能靠源码级断言。判据落在两处：
 *      `SettingsHandlesPanel` 把 `id` 交给 `FoldBlock`、`FoldBlock` 把 `id` 画在根节点上。
 *
 *   ② 开机自启**只能有一个入口**。B5c 之前同一个 OS 状态有两个开关、两份持久化，
 *      而且会互相覆盖。删掉的那一行最容易在"补功能"时被接回来，所以这里反向钉死：
 *      `SettingsResidentPanel` / `Settings.tsx` 不许再出现 `launchAtLogin` 这条链，
 *      唯一写入口是 `HostGeneralPanel` 的 `set_autostart` + 同值双写。
 *
 * 行为面另有判据（不重复）：`components/SettingsGroupNavFoldReveal.test.tsx`（点导航真的展开、
 * 落点正确）、`components/host/HostGeneralPanel.test.tsx`（双写的入参与失败面）、
 * `services/settingsD5DoubleWrite.test.ts`（落库+广播走现有回路）。
 */
import { describe, expect, it } from 'vitest';
import { code } from './settingsSourceProbe.test-utils';

const HANDLES = code('src/windows/activity/features/settings/components/SettingsHandlesPanel.tsx');
const FOLD = code('src/windows/activity/features/settings/components/host/FoldBlock.tsx');
const RESIDENT = code('src/windows/activity/features/settings/components/SettingsResidentPanel.tsx');
const SETTINGS = code('src/windows/activity/features/settings/components/Settings.tsx');
const GENERAL = code('src/windows/activity/features/settings/components/host/HostGeneralPanel.tsx');
const NAV = code('src/windows/activity/features/settings/components/SettingsGroupNav.tsx');

describe('[B5c] ① 把手绑定折进折叠块，且锚点在可见头部', () => {
  it('b5c01_the_handles_card_is_a_fold_block_titled_like_the_nav_anchor', () => {
    expect(HANDLES).toContain('<FoldBlock');
    /* 标题与导航锚点标题逐字一致（B5b 立的规矩：导航点哪个名字，卡上就得写哪个） */
    expect(HANDLES).toContain('title="把手绑定"');
    /* hint 说清这一块管什么（三形态 × 5 槽）与"改完即生效"（本卡不走草稿/保存） */
    expect(HANDLES).toContain('三形态 × 5 槽');
    expect(HANDLES).toContain('改完即生效');
    /* 折叠块自己就是卡片：再叠一层 `SettingsPanelHeader` 等于同一张卡两个标题 */
    expect(HANDLES).not.toContain('SettingsPanelHeader');
    /* 默认折叠：整块不传 `defaultOpen`（壳的默认值就是 false），也不许有人传 true */
    expect(HANDLES).not.toContain('defaultOpen');
  });

  it('b5c02_the_anchor_id_is_handed_to_the_fold_block_which_puts_it_on_its_root', () => {
    /* ① 卡片：把 `id` 交给 `FoldBlock`（不是画在自己的一层 div 上、更不是画进折叠体） */
    expect(HANDLES).toContain('id={id}');
    /* ② 壳：`id` 画在 `<section>` 根节点上，与 `data-block` 同一个值；折叠体是 `${id}-body` */
    expect(FOLD).toMatch(/<section[^>]*data-block=\{id\}[^>]*id=\{id\}/);
    expect(FOLD).toContain('const bodyId = `${id}-body`;');
    /* ③ 折叠体确实是 `hidden`（这条不变，锚点才必须留在外面） */
    expect(FOLD).toContain('hidden={!open}');
  });

  it('b5c03_the_nav_asks_the_fold_to_open_before_measuring_the_landing', () => {
    /* 顺序是这个机制的全部：先展开（同步进 DOM）、再测落点。异步化会让落点用展开前的
       `scrollHeight` 算，页尾锚点少滚一截。 */
    expect(NAV).toContain('requestFoldReveal(anchorId)');
    expect(NAV).toContain('flushSync');
    const revealAt = NAV.indexOf('requestFoldReveal(anchorId)');
    const maxScrollAt = NAV.indexOf('container.scrollHeight - container.clientHeight');
    expect(revealAt).toBeGreaterThan(-1);
    expect(maxScrollAt, '找不到可滚量那行（改了写法要同批改本条）').toBeGreaterThan(-1);
    expect(revealAt).toBeLessThan(maxScrollAt);
  });
});

describe('[B5c] ② 开机自启只剩一个入口（D5）', () => {
  it('b5c04_the_resident_card_no_longer_carries_a_launch_at_login_switch', () => {
    expect(RESIDENT).not.toContain('launchAtLogin');
    expect(RESIDENT).not.toContain('toggleLaunchAtLogin');
    expect(RESIDENT).not.toContain('launchAtLoginLabel');
    /* 真正属于"常驻"的三件事还在 */
    expect(RESIDENT).toContain('toggleCloseToTray');
    expect(RESIDENT).toContain('toggleShowTrayIcon');
    expect(RESIDENT).toContain('toggleStartMinimized');
  });

  it('b5c05_the_settings_page_does_not_wire_the_removed_switch', () => {
    expect(SETTINGS).not.toContain('launchAtLogin');
    expect(SETTINGS).not.toContain('onLaunchAtLoginChange');
    expect(SETTINGS).toContain('<SettingsResidentPanel');
  });

  it('b5c06_the_single_entry_writes_both_persisted_copies_in_the_same_tick', () => {
    /* 唯一入口：`set_autostart`（写注册表 + 回写 autostart_enabled） */
    expect(GENERAL).toContain('settingsApi.setAutostart(v)');
    /* 同一值补写 `AppSettings.launchAtLogin`（`cmd_commit_app_settings` + 广播） */
    expect(GENERAL).toContain('commitSettingsPatch({ launchAtLogin: v })');
    /* 顺序：OS 先落（用户要即时反馈），再双写 */
    expect(GENERAL.indexOf('setAutostart(v)'))
      .toBeLessThan(GENERAL.indexOf('commitSettingsPatch({ launchAtLogin: v })'));
  });

  it('b5c07_no_other_settings_component_writes_autostart', () => {
    /* 防"补功能时把第二个入口接回来"：写 autostart / 写 launchAtLogin 的调用点各只一处 */
    const writers = [
      'components/SettingsHandlesPanel.tsx',
      'components/SettingsResidentPanel.tsx',
      'components/SettingsTrackingPanel.tsx',
      'components/SettingsAppearancePanel.tsx',
      'components/SettingsDataSafetyPanel.tsx',
      'components/host/HostSyncPanel.tsx',
      'components/host/HostThemeCard.tsx',
      'components/host/HostHighlightCard.tsx',
      'components/host/HostPillLookCard.tsx',
      'components/host/HostPluginsPanel.tsx',
      'components/host/HostAiCard.tsx',
    ].map((rel) => code(`src/windows/activity/features/settings/${rel}`));
    for (const source of writers) {
      expect(source).not.toContain('setAutostart');
      expect(source).not.toContain('launchAtLogin');
    }
  });
});
