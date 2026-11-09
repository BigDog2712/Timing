/**
 * Timing — 手机端「点开看 / 结束补名字」的源码判据（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 与 `MobileSheets.source.test.ts` 同一套写法（去掉注释再比），拆开只为守住单文件 ≤300 行。
 *
 * 这一轮的两条主人反馈都落在"接线"上，行为测试不容易覆盖：
 *   1. 便利贴点行必须进**只读全文**面板（不是直接进编辑框，长正文会被压在框里滚）；
 *   2. 结束一段未命名的计时要能问到名字，而且只在这条记录挂在「未归类」时才问。
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

const NOTES = code('./NotesPage.tsx');
const TIMER = code('./TimerPage.tsx');
const NOTE_VIEW = code('./NoteViewSheet.tsx');
const NAME_STOP = code('./NameStopSheet.tsx');
const STOP_NAMING = code('../../hooks/useStopNaming.ts');

describe('便利贴：点行看整张（V0.11.32）', () => {
  /**
   * 主人原话：「点击便利贴可弹出查看完整便利贴」。列表行正文 `line-clamp: 2`，
   * 只够认出是哪一张 —— 点行必须进**只读全文**面板，不是直接进编辑框
   * （编辑框 168px 高，长正文照样只能滚着看开头）。
   */
  it('note_row_opens_the_full_view_not_the_editor', () => {
    expect(NOTES, '点行没有打开「看整张」面板').toContain(
      "openSheet({ kind: 'noteView', noteId: note.id })",
    );
    expect(NOTES, '点行又直接进编辑页了（长正文会被压在输入框里）').not.toContain(
      "openSheet({ kind: 'noteEdit', noteId: note.id })",
    );
  });

  /**
   * 点按走正经 `onClick`，不押在手写的 `pointerup` 分支上：手机上「点一下打开」是列表
   * 最常用的动作，而 pointer 事件在部分 WebView 上会被父级滚动抢走。长按之后紧跟的那次
   * click 必须挡掉，否则「长按删除」会顺手把这张便利贴的全文打开。
   */
  it('tap_is_a_real_click_and_long_press_swallows_its_click', () => {
    expect(NOTES, '点行没有挂 onClick').toMatch(/className="m-note"[\s\S]{0,300}onClick=/);
    expect(NOTES, '长按之后没挡那次 click → 删除的同时又打开了全文').toContain(
      'longPressed.current',
    );
  });

  /** 全文区不许再封行数：那正是这次要修掉的东西；并且整块可滚（长正文看不完也能翻）。 */
  it('full_text_is_not_clamped_and_can_scroll', () => {
    expect(NOTE_VIEW, '全文面板没有全文区').toContain('m-note__full');
    expect(NOTE_VIEW, '全文区被写死了行数').not.toContain('line-clamp');
  });

  /** 看完整张要能直接改成编辑，不然用户还得退回去再长按一次。 */
  it('view_has_an_edit_exit', () => {
    expect(NOTE_VIEW).toContain("openSheet({ kind: 'noteEdit', noteId })");
  });
});

describe('未命名计时：结束请填名字（V0.11.32）', () => {
  /**
   * 主人原话：「支持未命名事件直接计时……结束计时时，应让用户填入事项名称」。
   *
   * 三条接线各钉一处：计时页走命名出口、出口只在「未归类」时开口、
   * 命名面板只改归属（不碰起止时间与备注）。
   */
  it('timer_page_stop_goes_through_the_naming_exit', () => {
    expect(TIMER, '计时页没接命名出口').toContain('useStopNaming()');
    expect(TIMER, '结束按钮没走命名出口').toContain('stopWithNaming()');
    expect(TIMER, '又直接调 actions.stop() → 未命名的一笔会静默留在库里').not.toContain(
      'actions.stop()',
    );
  });

  it('naming_is_asked_only_for_unnamed_records', () => {
    expect(STOP_NAMING, '判据不在唯一那处定义上').toContain('isUnnamedRecord(result.record)');
    /* 还没落库成功 / 太短被丢掉时不能问名字（问了也没有记录可改） */
    expect(STOP_NAMING, '失败或已丢弃的记录也会弹面板').toContain('if (!result || result.discarded) return;');
  });

  it('naming_panel_only_reassigns_the_owner', () => {
    expect(NAME_STOP, '没有把记录改挂到新事项上').toContain(
      'recordApi.update(record.id, { itemId: targetId })',
    );
    /* 只许**一次** update，且 patch 里只有 itemId：带上起止时间就会重写用户没动过的时间 */
    const updates = NAME_STOP.match(/recordApi\.update\([^)]*\)/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('{ itemId: targetId }');
    expect(NAME_STOP, '建完事项没有 reload（下一个面板还是旧列表）').toContain(
      'await useItemStore.getState().reload()',
    );
  });

  /** 可以拒绝：不命名是合法结局，直接关，不弹红字。 */
  it('not_naming_is_a_legal_ending', () => {
    expect(NAME_STOP).toContain('先不命名');
    expect(NAME_STOP).toContain("closeSheet('nameStop')");
  });
});
