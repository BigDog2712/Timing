/**
 * Timing — 手机端「点了没反应」的源码级判据（[V0.11.30]）
 * -----------------------------------------------------------------------------
 * 这一轮主人一次报了 9 条，其中三条（倒计时 X / 换事项 X / 事项编辑 X）是同一个 bug，
 * 另两条（点事项应唤起编辑、便利贴没有删除入口）是「有动作但看不见 / 点错地方」。
 *
 * 组件测试能验行为，但要渲染整页 + 模拟指针事件才碰得到；这类**接线错误**更适合源码判据：
 *   - 谁把 `closeSheet` 裸传给 `onClose` / `onClick`，这里就红；
 *   - 谁把「点行 = 开始计时」改回来，这里也红。
 *
 * 判据在去掉注释之后比：这些词在解释性注释里会正当地出现（本轮注释里就有 `onClose={closeSheet}`）。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 会被 `Sheet` 的 `onClose` / 遮罩 `onClick` 直接调到的五个面板。 */
const SHEETS = [
  'CountdownSheet',
  'SwitchItemSheet',
  'ItemMenuSheet',
  'NoteItemSheet',
  'RecordEditSheet',
] as const;

const ITEMS = code('./ItemsPage.tsx');
const NOTES = code('./NotesPage.tsx');
const TIMER = code('./TimerPage.tsx');
const SHEET = code('./Sheet.tsx');
const DONE_ROW = code('./DoneRow.tsx');
const SHELL = code('./MobileShell.tsx');

describe('面板关闭：X 必须真的关掉（V0.11.30）', () => {
  /**
   * 裸传引用的写法一律不许：`onClose={closeSheet}` 会把 MouseEvent 塞进 `kind`。
   * 现在 store 侧有类型守卫兜底，但**两道防线都要在**——守卫是给已存在的代码，
   * 判据是给以后新写的面板。
   */
  it('no_sheet_hands_closeSheet_straight_to_a_handler', () => {
    for (const name of SHEETS) {
      const src = code(`./${name}.tsx`);
      expect(src, `${name} 里把 closeSheet 裸传给了 onClose/onClick（事件对象会变成 kind）`)
        .not.toMatch(/\bon(Close|Click)=\{closeSheet\}/);
    }
  });

  /** 每个面板关的是「自己这一种」：异步收尾不能顺手关掉用户后开的那张。 */
  it('each_sheet_closes_its_own_kind', () => {
    const expected: Array<[string, string]> = [
      ['CountdownSheet', 'countdown'],
      ['SwitchItemSheet', 'switchItem'],
      ['ItemMenuSheet', 'itemMenu'],
      ['NoteItemSheet', 'noteItem'],
      ['RecordEditSheet', 'recordEdit'],
    ];
    for (const [name, kind] of expected) {
      const src = code(`./${name}.tsx`);
      expect(src, `${name} 没有 closeSheet('${kind}')`).toContain(`closeSheet('${kind}')`);
    }
  });

  /** 外壳本身：X 按钮存在、点遮罩也关（两个出口都不能只写一半）。 */
  it('sheet_ships_both_exits', () => {
    expect(SHEET).toContain('onClick={dismissible ? onClose : undefined}');
    expect(SHEET).toContain('aria-label="关闭"');
    expect(SHEET, 'X 按钮没有绑 onClose').toMatch(/onClick=\{onClose\}/);
  });
});

describe('点按语义：点事项 = 编辑，计时入口不重复（V0.11.30 / 改于 V0.11.31）', () => {
  /**
   * 主人原话：「点按事项后应唤起编辑界面」。此前是点行 `startOrSwitch`、长按才弹菜单，
   * 于是「想看这条事项叫什么 / 归档它」会先白白开出一段计时。
   */
  it('tapping_a_done_row_opens_the_item_menu', () => {
    expect(ITEMS, '点行没有回到事项菜单').toContain(
      "openSheet({ kind: 'itemMenu', itemId: row.itemId })",
    );
  });

  /**
   * [V0.11.31] 主人原话：「应不与计时界面功能重复」。上一版为了保留计时入口，
   * 在行尾加了个「▶ 开始」按钮；现在这一页整段变成「已完成待办」，
   * 计时只在计时页 / 换事项面板里有。**再加回来就是功能重复**，这里钉死。
   */
  it('items_page_has_no_timer_entry', () => {
    expect(ITEMS, '事项页又出现了「开始这一条」').not.toContain('startOrSwitch');
    expect(ITEMS, '事项页又出现了行尾「开始」按钮').not.toContain('m-record__start');
    expect(ITEMS, '事项页又挂上了长按开始').not.toContain('useLongPress');
  });
});

describe('已完成待办：按事项合并（V0.11.31）', () => {
  /**
   * 主人原话：「记录应改为已完成待办，对同事项多段时间的，按事项合并」。
   * 判据钉的是**接线**：这一页必须走 `groupTodayDone`，而且三个实参一个都不能少——
   * 少了 `todos` 就没有勾选态，少了 `items` 就解析不出事项名（删掉事项后要显示兜底名）。
   */
  it('items_page_merges_by_item_through_the_pure_function', () => {
    expect(ITEMS, '第三段没有走按事项合并的纯函数').toContain(
      'groupTodayDone(today.rows, todos, (itemId) => itemName(items, itemId))',
    );
    /* 行组件单独成文件（行数门禁），段数标记跟着它走 */
    expect(DONE_ROW, '多段没有标出段数').toContain('row.count > 1');
    expect(DONE_ROW, '已完成 / 未勾选没有图标以外的文字线索').toContain('未勾选');
  });

  /** 段落标题必须是「已完成待办」：还叫「今日记录」就等于没改口径。 */
  it('section_is_renamed_to_done_todos', () => {
    expect(ITEMS, '第三段还叫「今日记录」').not.toContain('>今日记录<');
    expect(ITEMS).toContain('已完成待办');
  });
});

describe('换事项：常用 / 近期分组（V0.11.31）', () => {
  const SWITCH = code('./SwitchItemSheet.tsx');

  /**
   * 主人原话：「常用是用户自己设置的，参考电脑端」。电脑版那两个函数就是
   * `pinnedItems`（is_pinned）+ `recentItems`（updatedAt 倒序前 N），默认条数与电脑版同源。
   */
  it('groups_come_from_the_same_helpers_as_desktop', () => {
    expect(SWITCH, '没有用电脑版的常用分组').toContain('pinnedItems(items)');
    expect(SWITCH, '没有用电脑版的近期分组 / 条数常量').toContain(
      'recentItems(items, RECENT_ITEMS_DEFAULT)',
    );
  });

  /**
   * 星标写的是 `items.is_pinned`——与电脑版**同一个字段**，不是手机自己的一份偏好。
   * 变异「把 patch 写成 { isPinned: item.isPinned }」或换成别的字段名，这里会红。
   */
  it('pin_writes_the_shared_is_pinned_flag', () => {
    expect(SWITCH).toContain('itemApi.update({ id: item.id, patch: { isPinned: next } })');
    expect(SWITCH, '设完常用没有重拉事项表（界面看不到变化）').toContain(
      'await useItemStore.getState().reload()',
    );
  });
});

describe('待办排时间：字段口径照电脑版（V0.11.31）', () => {
  const PLAN = code('./TodoPlanSheet.tsx');

  /**
   * **本轮最容易写反的一处**：电脑版是「截止时间 → planned_at、开启时间 → remind_at」，
   * 手机端只暴露「哪天几点」（= 开启时间），所以必须 `create(标题, null, at)`。
   * 若把 at 塞进 plannedAt，后端会拿它判「逾期」并在第二天把待办悄悄清掉——用户只会觉得
   * 「我排的待办自己没了」。判据把实参顺序钉死。
   */
  it('plan_time_goes_to_remind_at_not_planned_at', () => {
    expect(PLAN, '排的时间写进了 plannedAt（那是电脑版的截止时间）').toContain(
      'todosActions.create(title.trim(), null, at)',
    );
    expect(PLAN, '「不排期」没有把两个时间都清空').toContain(
      'todosActions.create(title.trim(), null, null)',
    );
  });

  /** 过去的时间不许提交：后端会把它当过期静默处理，用户看到的是「加了但没响」。 */
  it('past_time_is_blocked', () => {
    expect(PLAN).toContain('const past = at <= Date.now();');
    expect(PLAN, '确认按钮没有挡住过去的时间').toMatch(/disabled=\{busy \|\| past/);
  });

  /** 通知权限必须在这次点击里申请（Android 13+ 要求系统弹窗绑用户手势）。 */
  it('asks_notification_permission_in_the_click', () => {
    expect(PLAN).toContain('await ensureNotifyPermission()');
  });

  /** 排时间入口：空标题时不能落库（标题是 1-200 的必填），要明说。 */
  it('items_page_explains_the_empty_draft_instead_of_silence', () => {
    expect(ITEMS).toContain("先写要做什么，再排时间");
    expect(ITEMS).toContain("openSheet({ kind: 'todoPlan', title })");
  });
});

describe('便利贴：看得见的删除入口（V0.11.30）', () => {
  /** 长按删除一直有，但隐形手势就是「没有」。 */
  it('note_row_has_a_visible_delete_button', () => {
    expect(NOTES, '便利贴行内没有删除按钮').toContain('m-note__del');
    expect(NOTES).toContain('TrashIcon');
    expect(NOTES, '删除按钮没有吞掉 pointerdown').toContain('stopPropagation');
  });

  /** 列表取的是全部（不按日期过滤）：往期便利贴必须能看见。 */
  it('note_list_is_not_date_filtered', () => {
    expect(NOTES).toContain('listNotes()');
  });
});

describe('计时页：快捷同步（V0.11.30）', () => {
  /**
   * 主人要「不用翻设置页也能同步一次」。判据钉两件事：
   * 调的是同一个命令（不复制一套同步逻辑），失败原文照说（不润色成空话）。
   */
  it('timer_page_reuses_the_same_sync_command', () => {
    expect(TIMER).toContain('mobileNative.syncRun()');
    expect(TIMER).toContain('syncReportText');
    expect(TIMER).toContain('syncErrorText');
  });

  /** 同步中要挡住第二次点击，否则用户以为按钮没反应。 */
  it('sync_button_locks_while_running', () => {
    expect(TIMER, '同步按钮没有 disabled').toMatch(/disabled=\{syncing\}/);
  });
});

describe('Sheet 分发：新面板不能静默消失（V0.11.31）', () => {
  /**
   * `SheetHost` 原来是 `default: return null`：以后再加一种面板却忘了接上，
   * 点了没反应、控制台也没有一行字 —— 正是这一整轮在消灭的那类坏法。
   * 现在穷尽 switch + `never` 断言，漏接会在 **TS 编译期**报错，这里再兜一道。
   */
  it('sheet_host_covers_every_kind_exhaustively', () => {
    expect(SHELL, '排时间面板没有接到 SheetHost 上').toContain("case 'todoPlan':");
    expect(SHELL, '又回到了 default 分支：漏接的面板会静默不显示').not.toContain('default:');
    expect(SHELL, '没有穷尽性断言').toContain('const never: never = sheet;');
  });
});
