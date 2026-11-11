/**
 * Timing — 「计时」与「专注会话」的别名清零判据（P0-07 §1）
 * -----------------------------------------------------------------------------
 * P0-07 的验收口径只有一条：**同义词 / 别名清单为空**。也就是说，同一件事不能既叫「专注」
 * 又叫「计时」——因为这两类东西的账目性质正好相反：
 *
 *   · **专注会话**（番茄钟 / 自由专注）：写 `focus_history_groups` / `focus_history_spans`，
 *     **不写 `time_records`**，不进时间账；
 *   · **计时**（倒计时 / 摸鱼 / 正计时）：写 `time_records`，**计入时间账**。
 *
 * 这条判据靠人眼守不住：文案散在 locale 位置数组、组件内的 `COPY`、以及药丸的自绘菜单里，
 * 谁顺手写一句「番茄计时」都不会报错，只会让用户月底对不上账。所以改成机器判据：
 *
 *  ① 专注会话侧的**四个组件**，去掉注释后源码里**一个「计时」字都不许有**；
 *  ② 覆盖掉的那三条 locale 别名（`focusModePomodoro` / `pomodoroTaskEdit` /
 *     `pomodoroTimingSettings`）必须真的被组件弃用，改走 `focusSessionCopy` —— 否则
 *     locale 里那句「番茄计时」还在界面上；
 *  ③ 覆盖后的新文案本身不含「计时」（`hint` 除外：它正当指向**另一个**东西「倒计时」）；
 *  ④ 计时侧的三个落点必须都带「计入时间账」，且工具页真的挂上了状态行。
 *
 * 「专注」在专注会话侧可以出现、「计时」在计时侧可以出现；不允许的是交叉。
 * 读文件放**模块级**（同 `usePillAction.source.test.ts`）：路径写错就直接在这一行报。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRONTEND_MESSAGE_KEYS, FRONTEND_SOURCE_RESOURCES } from '../../../shared/i18n/generated/resources.ts';
import { FOCUS_SESSION_COPY, focusSessionCopy } from './focusSessionCopy.ts';

/**
 * 直接从 locale 位置数组里取某个 key 的源语言（zh-CN）值。
 *
 * 用途：证明「自由专注页签的新建标题没有被一刀切改掉」——它读的仍是 locale 的
 * `tools.pomodoroTaskCreate`，所以必须真的等于「新建专注」。只断言源码里出现这个
 * key 名字不够：如果有人把 locale 那一格的值改了，源码照样有 key、界面上却已经变了。
 */
const LOCALE_KEYS = FRONTEND_MESSAGE_KEYS as readonly string[];
const LOCALE_VALUES = FRONTEND_SOURCE_RESOURCES as readonly unknown[];
const localeValue = (key: string): unknown => LOCALE_VALUES[LOCALE_KEYS.indexOf(key)];

/** 读源码并去掉 `/* … *\/`（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function code(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const POMODORO_PANEL = code('../components/PomodoroToolPanel.tsx');
const FREE_FOCUS = code('../components/FreeFocusContent.tsx');
const TASK_EDITOR = code('../components/PomodoroTaskEditor.tsx');
const SETTINGS_PICKER = code('../components/PomodoroSettingsPicker.tsx');
const LEDGER_NOTE = code('../components/FocusSessionLedgerNote.tsx');
const STATUS_ROW = code('../components/HostTimingStatusRow.tsx');
const TOOLS_PAGE = code('../components/Tools.tsx');
const PILL_BAR = code('../../../components/pill/PillBar.tsx');
const PILL_INLINE_EDIT = code('../../../hooks/usePillInlineEdit.ts');
const COUNTDOWN_CARD = code('../../../components/menu/CountdownCard.tsx');
const COUNTDOWN_MENU = code('../../../components/menu/CountdownMenu.tsx');
const MOYU_MENU = code('../../../components/menu/MoyuMenu.tsx');

describe('计时语义统一（P0-07 判据①：别名清单为空）', () => {
  it('focus_session_surfaces_never_use_the_word_that_means_time_logged', () => {
    /* 番茄钟页签、自由专注页签、番茄任务编辑器、时长选择器 —— 它们都不写 time_records，
       所以都不许出现「计时」。一旦有人在这里写回「番茄计时」，用户就会以为它在记账。 */
    for (const source of [POMODORO_PANEL, FREE_FOCUS, TASK_EDITOR, SETTINGS_PICKER]) {
      expect(source).not.toContain('计时');
    }
  });

  it('the_three_aliased_locale_keys_are_actually_abandoned', () => {
    /* 只改文案不弃用 key 等于没改：locale 里那句「番茄计时」会继续渲染出来 */
    expect(POMODORO_PANEL).not.toContain('tools.focusModePomodoro');
    expect(TASK_EDITOR).not.toContain('tools.pomodoroTaskEdit');
    expect(SETTINGS_PICKER).not.toContain('tools.pomodoroTimingSettings');
    /* 弃用之后必须真的接上覆盖文案 */
    expect(POMODORO_PANEL).toContain('focusSessionCopy');
    expect(TASK_EDITOR).toContain('focusSessionCopy');
    expect(SETTINGS_PICKER).toContain('focusSessionCopy');
  });

  it('the_overriding_copy_itself_does_not_say_timer', () => {
    for (const locale of ['zh', 'en'] as const) {
      const copy = FOCUS_SESSION_COPY[locale];
      for (const value of [copy.focusModePomodoro, copy.editTitle, copy.settingsTitle, copy.ledger]) {
        expect(value).not.toContain('计时');
      }
    }
    /* hint 是唯一允许出现「计时」的地方：它正当指向「倒计时」（另一个东西），
       而且必须把替代方案说出口，否则用户只知道不能做什么、不知道该做什么 */
    expect(FOCUS_SESSION_COPY.zh.hint).toContain('倒计时');
    expect(FOCUS_SESSION_COPY.zh.ledger).toContain('不计入时间账');
  });

  it('every_focus_tab_states_whether_it_counts_exactly_once', () => {
    /* 两个页签各渲染一句；多渲染一句就成了两句重复的免责声明 */
    expect(LEDGER_NOTE).toContain('focusSessionCopy');
    expect(LEDGER_NOTE).toContain('data-tools-ledger');
    expect(POMODORO_PANEL.match(/<FocusSessionLedgerNote/g)?.length).toBe(1);
    expect(FREE_FOCUS.match(/<FocusSessionLedgerNote/g)?.length).toBe(1);
  });

  it('the_pill_never_calls_a_logged_timer_a_focus_session', () => {
    /* 「专注进行中，事项已锁定」说的是**进账的计时**在跑；这是本仓唯一一处交叉用法 */
    for (const source of [PILL_BAR, PILL_INLINE_EDIT]) {
      expect(source).not.toContain('专注进行中');
      expect(source).toContain('计时进行中');
    }
  });

  it('every_timer_entry_says_it_is_counted_in_the_time_log', () => {
    /* 计时侧的三个落点：倒计时卡、倒计时菜单、摸鱼菜单 */
    expect(COUNTDOWN_CARD).toContain('data-countdown-ledger="counted"');
    expect(COUNTDOWN_CARD).toContain('计入时间账');
    expect(COUNTDOWN_MENU).toContain('data-countdown-ledger="counted"');
    expect(COUNTDOWN_MENU).toContain('计入时间账');
    expect(MOYU_MENU).toContain('data-countdown-ledger="counted"');
    expect(MOYU_MENU).toContain('计入时间账');
  });

  it('the_tools_page_actually_mounts_the_timing_status_row', () => {
    /* 写了组件不挂 = 用户看不到；这一批里最容易「写完就以为完了」的一步 */
    expect(TOOLS_PAGE).toContain('<HostTimingStatusRow />');
  });

  it('the_status_row_reuses_the_single_host_reading_path', () => {
    /* 一旦它自己开 listen / setInterval / 直接 ipc，就会出现「胶囊 12:31、状态行 12:29」
       —— 同一个数字两种写法，用户无法判断哪个是真的 */
    expect(STATUS_ROW).toContain('useHostTimerState');
    expect(STATUS_ROW).toContain('formatClock');
    expect(STATUS_ROW).not.toContain('setInterval');
    expect(STATUS_ROW).not.toContain('addEventListener');
    expect(STATUS_ROW).not.toContain('listen(');
    expect(STATUS_ROW).not.toContain('Date.now');
    /* 时长必须是秒表口径：`formatDuration` 会把 751 秒显示成「12m」，日内读数就丢了 */
    expect(STATUS_ROW).not.toContain('formatDuration');
  });

  it('the_pomodoro_mode_shares_the_name_of_its_own_phase_buttons', () => {
    /* 同一个页面上「模式页签」和「阶段按钮」指同一件事：
         页签 = 模式名，按钮 = 开始 / 暂停 / 跳过「番茄钟」阶段（locale idx 176–181）。
       页签若叫「番茄专注」，就在「专注 / 计时」这一维之外又造出「番茄专注 / 番茄钟」这一维的
       同义异名——正好违反 P0-07 自己的验收口径。所以模式名必须落在「番茄钟」家族里，
       且**不许含「专注」**（含了就是又分家）。 */
    const zh = FOCUS_SESSION_COPY.zh;
    expect(zh.focusModePomodoro).toBe('番茄钟');
    expect(zh.focusModePomodoro).not.toContain('专注');
    expect(zh.editTitle).toBe('编辑番茄钟');
    /* 英文侧按同一口径，不新造词：locale 原本就是 Pomodoro / Edit Pomodoro timer */
    expect(FOCUS_SESSION_COPY.en.focusModePomodoro).toBe('Pomodoro');
    expect(FOCUS_SESSION_COPY.en.editTitle).toBe('Edit Pomodoro');
    /* 「专注设置」保留：它说的是设置的归属，不是给番茄钟起第二个名字 */
    expect(zh.settingsTitle).toBe('专注设置');
  });

  it('the_pomodoro_create_form_and_the_free_focus_one_say_different_things', () => {
    /* 两个页签的新建表单共用一个 locale key（idx 28「新建专注」）。
       番茄页签里「新建专注 / 编辑番茄钟」是同对象两名，所以番茄侧覆盖成「新建番茄钟」；
       自由专注页签里「新建专注」本来是对的，必须**继续**用它。
       一刀切改 locale 会弄错自由专注侧，所以这里两头都钉住。 */
    expect(FOCUS_SESSION_COPY.zh.createTitle).toBe('新建番茄钟');
    expect(FOCUS_SESSION_COPY.zh.createTitle).not.toContain('专注');
    expect(FOCUS_SESSION_COPY.en.createTitle).toBe('New Pomodoro');
    /* 番茄页签：走覆盖值，不再读 locale 那个 key */
    expect(POMODORO_PANEL).toContain('copy.createTitle');
    expect(POMODORO_PANEL).not.toContain('tools.pomodoroTaskCreate');
    /* 自由专注页签：仍读 locale，且覆盖值一缕都没漏进去 */
    expect(FREE_FOCUS).toContain('tools.pomodoroTaskCreate');
    expect(FREE_FOCUS).not.toContain('createTitle');
    /* 最终值证明：那边界面上写的确实还是「新建专注」 */
    expect(localeValue('tools.pomodoroTaskCreate')).toBe('新建专注');
  });

  it('the_locale_files_stay_untouched_so_the_positional_arrays_cannot_shift', () => {
    /* 四个 locale 是按索引对齐的位置数组：动一处值就等于整体错位，所以改名一律在渲染层做。
       下面钉住取值函数的出口（中文走覆盖值、非中文走英文），证明我们改的是渲染不是字典。
       注意：英文侧 `focusModePomodoro` 恰好与 locale 原值同为「Pomodoro」——
       覆盖存在只是为了留一个显式的接缝，zh 侧才是真正被替换掉的那一个。 */
    expect(focusSessionCopy('zh-CN').focusModePomodoro).toBe('番茄钟');
    expect(focusSessionCopy('en-US').focusModePomodoro).toBe('Pomodoro');
    /* 未知 / 空 locale 一律走英文，不许抛错（与标题栏胶囊同口径） */
    expect(focusSessionCopy('ru-RU').focusModePomodoro).toBe('Pomodoro');
    expect(focusSessionCopy('').ledger).toBe(FOCUS_SESSION_COPY.en.ledger);
  });
});
