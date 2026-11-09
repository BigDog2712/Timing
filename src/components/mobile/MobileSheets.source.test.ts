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

describe('点按语义：点事项 = 编辑，行尾按钮 = 开始（V0.11.30）', () => {
  /**
   * 主人原话：「点按事项后应唤起编辑界面」。此前是点行 `startOrSwitch`、长按才弹菜单，
   * 于是「想看这条事项叫什么 / 归档它」会先白白开出一段计时。
   */
  it('tapping_a_record_row_opens_the_item_menu', () => {
    expect(ITEMS, '点行没有回到事项菜单').toContain(
      "onEdit={() => openSheet({ kind: 'itemMenu', itemId: group.itemId })}",
    );
    expect(ITEMS, '「开始这条」被绑到了点行上（应挪到行尾按钮）').toContain(
      'onStart={() => void timerActions.startOrSwitch(group.itemId)}',
    );
    /* 长按仍是「开始」：老手势留一条路，但可见入口必须存在。 */
    expect(ITEMS, '行尾没有「开始」按钮').toContain('m-record__start');
    /* **接线才是判据本体**：上面两个属性名写对了也可能绑反。
       `useLongPress(长按, 点按)` 的第一个实参是长按，第二是点按 —— 这里点按必须是 onEdit。
       （第一版只钉了属性名，变异「把两个实参对调」照样绿，已改。） */
    expect(ITEMS, '点按/长按接反了：点一下会开始计时而不是编辑').toContain(
      'useLongPress(onStart, onEdit)',
    );
  });

  /** 行内按钮必须吞掉 pointerdown，否则外层长按计时器同时启动，松手又弹编辑。 */
  it('row_button_swallows_pointer_events', () => {
    const at = ITEMS.indexOf('m-record__start');
    expect(at, '找不到行尾按钮').toBeGreaterThanOrEqual(0);
    const body = ITEMS.slice(at, at + 700);
    expect(body).toContain('onPointerDown={(e) => e.stopPropagation()}');
    expect(body).toContain('onPointerUp={(e) => e.stopPropagation()}');
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
