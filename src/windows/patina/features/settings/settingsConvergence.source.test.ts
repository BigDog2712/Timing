/**
 * P0-06「设置与备份职责收敛」的**源码级**判据（归属与口径）
 *
 * 这一批改的是「哪一层拥有哪个设置」，不是公式，纯函数测不到；而渲染测试（RTL）要付
 * 一整套交互模拟的成本才能换来同样的结论。所以沿用 B1 的先例
 * （`src/app/hooks/useThemeWiring.source.test.ts`）：把「谁还能改什么」钉在源码文本上。
 *
 * [0.12.1 T04b] 按组拆文件：**五组锚点**那一组（原判据②）挪到
 * `settingsGroups.source.test.ts`——它判的是「页面结构」，与这里的「归属/口径」是两回事，
 * 混在一起会让本文件先撞上 300 行门禁。共用探针见 `settingsSourceProbe.test-utils.ts`。
 *
 * 本文件五条判据对应 PRD 的验收句：
 *   ① 可改主色的控件**桌面侧** = 1（手机侧那一个是另一扇窗，由 import 图钉住），
 *      且分析窗**唯一**能写主题/主色的 ACL 权限是 `patina-host-settings`，
 *      旧写桥 `host-theme-write` 定义还在但无人引用
 *   ③ 主题模式开关已下线（三个同名入口之一）
 *   ④ 三个同名参数各只有一个可编辑处
 *   ⑤ 两处备份的对象不同（活动库 vs 计时记录）
 *   ⑥ i18n 是**位置数组**：值可以改，长度必须与 `FRONTEND_MESSAGE_KEYS` 逐位对齐
 */
import { describe, expect, it } from 'vitest';
import {
  capabilities,
  code,
  importersOf,
  permissionGrants,
  PROJECT_ROOT,
  readRaw,
  writersOf,
} from './settingsSourceProbe.test-utils';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { resolve } from 'node:path';

const SETTINGS = code('src/windows/patina/features/settings/components/Settings.tsx');
const APPEARANCE = code('src/windows/patina/features/settings/components/SettingsAppearancePanel.tsx');
const DATA_SAFETY = code('src/windows/patina/features/settings/components/SettingsDataSafetyPanel.tsx');

describe('① 主题/主色只有一个入口（P0-06 判据 1）', () => {
  it('p006_analysis_window_cannot_write_theme_or_accents', () => {
    /* 分析窗的**设置界面**里不许出现写主题/写主色的调用面。
       注意别把 `src/platform/runtime/hostThemeGateway.ts` 也列进来：它是**通道**，
       `theme_set` 这个命令名必须在那儿出现（否则不是「零控件」而是「通道也没了」的假绿）。 */
    const analysisUi = [
      'src/windows/patina/features/settings/components/Settings.tsx',
      'src/windows/patina/features/settings/components/SettingsAppearancePanel.tsx',
      'src/windows/patina/features/settings/components/SettingsInterfacePanel.tsx',
      'src/windows/patina/shell/AppShell.tsx',
      'src/windows/patina/shell/hooks/useAppThemeMode.ts',
      'src/windows/patina/shell/hooks/useHostThemeMode.ts',
    ];
    for (const rel of analysisUi) {
      const src = code(rel);
      expect(src, `${rel} 不该写回宿主主题`).not.toContain('writeHostThemeMode');
      expect(src, `${rel} 不该调用 theme_set`).not.toContain('theme_set');
      expect(src, `${rel} 不该调用 accent_set`).not.toContain('accent_set');
      expect(src, `${rel} 不该调用 setAccent`).not.toContain('setAccent(');
      expect(src, `${rel} 不该调用 resetAccents`).not.toContain('resetAccents(');
    }
    /* 通道仍在（不是「两边都没了」那种假绿）：唯一的写回实现留在 gateway 里。
       [P0-06 收口] 光有「零调用」只是**前端**没入口；分析窗 capability 也不再授予
       `host-theme-write`（见下一条用例），所以这条路径现在是双保险都断的。 */
    expect(code('src/windows/patina/platform/runtime/hostThemeGateway.ts'))
      .toContain('export async function writeHostThemeMode');
    /* …但视图层（features/app/shared/components）**一次都不再提这个名字**：零调用 = 零控件。 */
    expect(writersOf('writeHostThemeMode'), 'writeHostThemeMode 又被某个界面接回去了')
      .toEqual([]);
  });

  it('p006_one_accent_editor_and_no_legacy_theme_write_bridge', () => {
    /* 老名字是 `…analysis_capability_no_longer_grants_host_theme_write`，但它只判了第三件事，
       前两件靠别处的用例 —— 名字说了三件、断言只做一件，是最容易「看着绿其实没管」的形状。
       现在三条都写在这里：

       ① **写主色的控件**：桌面一个（`HostThemeCard`），手机一个（`ThemePicker`，另一扇窗）。
          两个都删不掉：桌面要改主题，Android 没有桌面设置页、必须有自己的入口。
       ② **ACL**：分析窗唯一被授予 `theme_set` / `accent_set` 的权限是
          `patina-host-settings`（T04 新加的写面）；旧写桥 `host-theme-write` 的定义还在，
          但没有任何 capability 引用它。
       ③ **import 图**：`ThemePicker` 只被手机页引用 —— 一旦有人把它接回桌面壳，
          「控件数 = 1」就真的不成立了，这条会先红。

       三者合起来才是 P0-06 的结论：入口只有一个，而且那个入口是**设置页**，不是第二个 App。 */
    expect([...new Set([
      ...writersOf('accentSet('),
      ...writersOf('setAccent('),
      ...writersOf('resetAccents('),
    ])].sort()).toEqual([
      'src/windows/patina/features/settings/components/host/HostThemeCard.tsx', // 桌面端唯一入口
      'src/windows/timing/components/settings/ThemePicker.tsx',                 // 手机端「外观」Tab
    ]);

    /* ② capability 面：按 windows 字段挑出覆盖分析窗的那几条 capability，看谁真正授予了
       `theme_set` / `accent_set`。`host-theme-read` 只有 get，`main-window-commands` 是
       Patina 自己那 117 条 —— 都不该命中。 */
    const grants = permissionGrants();
    const themeCommands = ['theme_set', 'accent_set'];
    const analysisWriters = capabilities()
      .filter((cap) => cap.windows.includes('patina') || cap.windows.includes('mini'))
      .flatMap((cap) => cap.permissions
        .filter((perm) => themeCommands.some((command) => grants.get(perm)?.has(command)))
        .map((perm) => `${cap.id}:${perm}`));
    expect(analysisWriters, '分析窗出现了第二条能写主题/主色的权限面').toEqual([
      'patina:patina-host-settings',
    ]);

    const bridged = capabilities()
      .filter((cap) => cap.permissions.includes('host-theme-write'))
      .map((cap) => cap.id);
    expect(bridged, '有人把 host-theme-write 又授回来了（那是 P0-06 摘掉的那条）').toEqual([]);
    /* 定义必须还在，而且它**确实**还允许 theme_set —— 否则上一条是假绿（空定义谁都不会命中）。 */
    expect(readRaw('src-tauri/permissions/patina-host-theme.toml'))
      .toContain('identifier = "host-theme-write"');
    expect(grants.get('host-theme-write')?.has('theme_set')).toBe(true);
    /* 宿主那 81 条命令面仍拥有这两个命令：摘的是「分析窗的引用」，不是宿主自己的能力。 */
    expect(grants.get('host-commands')?.has('theme_set')).toBe(true);
    expect(grants.get('host-commands')?.has('accent_set')).toBe(true);

    /* ③ 手机那条只被手机页引用（接回桌面壳 = 第二个控件，届时必须真的收窄成单项）。 */
    expect(importersOf('settings/ThemePicker'))
      .toEqual(['src/windows/timing/components/mobile/SettingsPage.tsx']);
  });

  it('p006_analysis_capability_keeps_its_read_and_core_grants', () => {
    /* 摘一条不能顺带把别的摘掉：分析窗启动后要读主题、要收事件、要调命令。
       少一条的症状是「窗开了、界面全哑、零日志」——所以逐条钉住。 */
    const capability = readRaw('src-tauri/capabilities/patina.json');
    for (const required of [
      'host-theme-read',             /* theme_get / accent_get：读主题与四色 */
      'main-window-commands',        /* Patina 自己的 117 条命令 */
      'patina-host-bridge',          /* 5 条只读：list_records / list_items / get_timer_state / note_list / todo_list */
      'patina-host-settings',        /* T04 的写面：设置页整页都在靠它 */
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:event:allow-emit',
      'core:window:allow-close',
      'core:window:allow-start-dragging',
      'opener:default',
    ]) {
      expect(capability, `分析窗 capability 少了 ${required}（ACL 会静默拒绝，零日志）`)
        .toContain(required);
    }
  });

  it('p006_only_one_accent_editor_in_the_whole_app', () => {
    /* PRD P0-06：「可改主色的控件数 = 1」。`themeActions.init()` 不算——那是读，不是控件。
       [0.12.1 T04b] 桌面侧**已经只剩一个**：旧的药丸内联面板（SettingsPanel → ThemePicker）
       本批删掉后，桌面再也没有第二个写主色的控件。

       为什么表里仍是两项、而不是团队要求的「收窄成单项」：第二项是**手机**那扇界面。
       `src/components/mobile/SettingsPage.tsx` 的「外观」Tab 仍然渲染 `ThemePicker`
       （Android 没有桌面设置页，手机必须有自己的入口），它调用 `themeActions.setAccent`。
       删掉它会让 Android 包失去唯一的主题入口。所以这里把判据从「数个数」升级成
       「桌面单项 + 手机那条被 import 图钉住」——比一个会被迫放宽的数字更难蒙。 */
    const accentWriters = [...new Set([
      ...writersOf('setAccent('),
      ...writersOf('resetAccents('),
      /* 分析窗的写面是 `hostSettingsGateway.accentSet(`，不是宿主的 `setAccent(`：
         判据要跟真实写入口径走，否则「控件数 = 1」退化成「用老名字的控件数 = 1」 */
      ...writersOf('accentSet('),
    ])].sort();
    expect(accentWriters).toEqual([
      'src/windows/patina/features/settings/components/host/HostThemeCard.tsx',  // 桌面端唯一入口
      'src/windows/timing/components/settings/ThemePicker.tsx',                  // 手机端「外观」Tab
    ]);
    /* 桌面侧（`src/features`）恰好一个 —— 这是「桌面只有一个入口」的字面判据。 */
    expect(accentWriters.filter((rel) => rel.startsWith('src/windows/patina/features/')))
      .toEqual(['src/windows/patina/features/settings/components/host/HostThemeCard.tsx']);
    /* 手机那条**只被手机页引用**：谁把它接回桌面壳，这条立刻红（那时才该真的收窄成单项）。 */
    expect(importersOf('settings/ThemePicker'))
      .toEqual(['src/windows/timing/components/mobile/SettingsPage.tsx']);
    /* 写主色的命令名在视图层一次都不出现（分析窗的写面在 `src/platform/**`，不在被扫的四块里）。 */
    expect(writersOf('accent_set')).toEqual([]);
    expect(writersOf('theme_set')).toEqual([]);
  });

  it('p006_theme_mode_switch_is_gone', () => {
    expect(SETTINGS).not.toContain('handleThemeModeChange');
    expect(SETTINGS).not.toContain('writeHostThemeMode');
    expect(SETTINGS).not.toContain('onThemeModeChange');
    expect(APPEARANCE).not.toContain('themeMode');
    expect(APPEARANCE).not.toContain('themeModeOptions');
    /* 深/浅跟随宿主这件事得说清楚，否则用户以为「分析窗不能改是 bug」。 */
    expect(APPEARANCE).toContain('ownerHint');
  });

  it('p006_neutral_color_schemes_survive_but_only_pick_surfaces', () => {
    /* 28 套预设不能一起下线（ARCH R4=A）：它们只决定中性底色，不碰宿主四色派生的令牌。 */
    expect(APPEARANCE).toContain('COLOR_SCHEME_OPTIONS');
    expect(APPEARANCE).toContain('neutralOnly');
    expect(APPEARANCE, '预设卡片里不该再出现主色取色行')
      .not.toContain('SwatchRow');
  });
});

describe('④ 三个同名参数各一个可编辑处（判据 3）', () => {
  it('p006_one_editor_per_parameter', () => {
    /* `timelineMergeGapSecs`：唯一可编辑处是分析窗设置「计时与记录」那一组。 */
    const tracking = code('src/windows/patina/features/settings/components/SettingsTrackingPanel.tsx');
    expect(tracking).toContain('timelineMergeGapControl');
    expect(SETTINGS).toContain('handleChange("timelineMergeGapSecs"');

    /* `minSessionSecs`：唯一可编辑处是历史页（`onMinSessionSecsChange`），设置页只读/不出现。 */
    expect(SETTINGS).not.toContain('minSessionSecs');
    expect(SETTINGS).not.toContain('onMinSessionSecsChange');
    expect(code('src/windows/patina/features/history/components/History.tsx')).toContain('onMinSessionSecsChange');

    /* `refreshIntervalSecs`：设置页里**没有任何**输入（它是刷新节奏，不是用户参数）。 */
    expect(SETTINGS).not.toContain('refreshIntervalSecs');
    expect(APPEARANCE).not.toContain('refreshIntervalSecs');
  });
});

describe('⑤ 两处备份的对象不同（判据 4）', () => {
  /** 位置数组 → 按 key 取值：i18n 是"同下标对齐"而不是对象，只能这么读。 */
  function readZhText(): (key: string) => string {
    const keys = readFileSync(resolve(PROJECT_ROOT, 'src/windows/patina/shared/i18n/generated/resources.ts'), 'utf8');
    const keyList = JSON.parse(keys.match(/FRONTEND_MESSAGE_KEYS = (\[[\s\S]*?\]) as const;/)![1]) as string[];
    const zh = readFileSync(resolve(PROJECT_ROOT, 'src/windows/patina/shared/i18n/generated/locales/zh-CN.ts'), 'utf8');
    const values = JSON.parse(
      zh.replace(/^[\s\S]*?FRONTEND_LOCALE_RESOURCES = /, '').replace(/\s*as const;?\s*$/, ''),
    ) as unknown[];
    return (key: string) => String(values[keyList.indexOf(key)]);
  }

  it('p006_analysis_backup_says_activity_library', () => {
    /* 分析窗这套备份的是**电脑活动库**：文案里必须出现「活动库」，不能再只写「备份」。 */
    const at = readZhText();
    expect(at('settings.backupRestoreTitle')).toContain('活动库');
    expect(at('settings.backupExportTitle')).toContain('活动库');
    /* 唯一入口的措辞落在「显示」分区里。 */
    expect(at('settings.appearanceTitle')).toBe('显示');
    /* 备份卡仍是活动库那套（没有被误接到宿主的计时数据上）。 */
    expect(DATA_SAFETY).toContain('onExportBackup');
    expect(DATA_SAFETY).toContain('settings.backupRestoreTitle');
    expect(DATA_SAFETY).toContain('settings.backupExportTitle');
    /* 分析窗这套**不碰** md_sync（那是宿主的计时数据备份）。 */
    expect(DATA_SAFETY).not.toContain('mdBackupApi');
    expect(DATA_SAFETY).not.toContain('MdSyncBackupCard');
  });

  it('p006_host_backup_says_timing_records', () => {
    /* 宿主这套（md_sync）备份的是**计时记录**：文案里必须说清，且与上面那套不同名。
       [0.12.1 T04b] 判据指向**搬家后**的文件：旧路径 `src/components/settings/MdSyncBackupCard.tsx`
       已随药丸内联面板删除，新住址是分析窗的 `components/host/`（className 与文案一字未改，
       所以下面这些子串断言的**语义**完全没变，只是路径换了）。 */
    const host = code('src/windows/patina/features/settings/components/host/MdSyncBackupCard.tsx');
    expect(host).toContain('计时记录');
    expect(host).toContain('恢复计时数据');
    /* 既有测试断言的子串不得被改掉（改文案不许打翻宿主测试）。 */
    expect(host).toContain('会用这份备份覆盖当前文件的计时记录');
    expect(host).toContain('恢复本身不会让你再丢一次');
    /* 宿主这套不许出现「活动库」——那是分析窗的对象。 */
    expect(host).not.toContain('活动库');
    /* 旧路径必须真的不在了：否则这次「搬家」只是复制，两份迟早走偏。 */
    expect(() => code('src/windows/timing/components/settings/MdSyncBackupCard.tsx')).toThrow();
  });
});

describe('⑥ i18n 位置数组必须继续对齐（红线）', () => {
  it('p006_locale_arrays_stay_aligned', () => {
    const keys = readFileSync(resolve(PROJECT_ROOT, 'src/windows/patina/shared/i18n/generated/resources.ts'), 'utf8');
    const keyList = JSON.parse(keys.match(/FRONTEND_MESSAGE_KEYS = (\[[\s\S]*?\]) as const;/)![1]) as string[];
    for (const locale of ['zh-CN', 'en-US', 'ru-RU', 'es']) {
      const raw = readFileSync(resolve(PROJECT_ROOT, `src/windows/patina/shared/i18n/generated/locales/${locale}.ts`), 'utf8');
      const values = JSON.parse(
        raw.replace(/^[\s\S]*?FRONTEND_LOCALE_RESOURCES = /, '').replace(/\s*as const;?\s*$/, ''),
      ) as unknown[];
      expect(values.length, `${locale} 的条目数与 FRONTEND_MESSAGE_KEYS 不一致（位置数组错位）`)
        .toBe(keyList.length);
    }
    /* 这一批只改值：键位总数没变（若有人顺手增删，长度断言会先红）。 */
    expect(keyList.length).toBe(939);
  });
});
