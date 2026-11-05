/**
 * Timing — noteStore 置顶开关单测（V0.3.0 / AC-64 / ADR-019）
 * -----------------------------------------------------------------------------
 * 只测 `setPinned` 这一条新链路，覆盖三件事：
 *   1. 乐观翻转：点下去立刻改本地值（不等 IPC 往返）；
 *   2. 落盘：`note_update` 拿到 `{ isPinned }`，成功后以服务端返回值为准；
 *   3. 失败回滚：IPC 抛错时本地值退回点之前，且 error 有文案（不留「假置顶」）。
 * 其余 store 行为（正文落盘 / 几何去抖）不在本文件范围。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../types/domain';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('../services/api', () => ({
  noteApi: { get: vi.fn(), update: updateMock },
}));

import { useNoteStore } from './noteStore';

const baseNote: Note = {
  id: 7,
  itemId: null,
  content: '写点东西',
  posX: 120,
  posY: 80,
  width: 320,
  height: 232,
  isOpen: true,
  isPinned: true,
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  updateMock.mockReset();
  useNoteStore.setState({
    note: { ...baseNote },
    savedContent: baseNote.content,
    loading: false,
    loaded: true,
    saving: false,
    error: null,
  });
});

describe('noteStore.setPinned', () => {
  it('取消置顶：先本地翻转，再按服务端返回值收敛', async () => {
    // 先断言「同步阶段就已翻转」：用一个未 resolve 的 promise 卡住 IPC
    let resolveUpdate: (n: Note) => void = () => {};
    updateMock.mockReturnValue(
      new Promise<Note>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const pending = useNoteStore.getState().setPinned(false);
    expect(useNoteStore.getState().note?.isPinned, '点击后应立即取消置顶').toBe(false);

    resolveUpdate({ ...baseNote, isPinned: false });
    await pending;

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ id: 7, patch: { isPinned: false } });
    expect(useNoteStore.getState().note?.isPinned).toBe(false);
    expect(useNoteStore.getState().error).toBeNull();
  });

  it('重新置顶：patch 里带 isPinned:true', async () => {
    useNoteStore.setState({ note: { ...baseNote, isPinned: false } });
    updateMock.mockResolvedValue({ ...baseNote, isPinned: true });

    await useNoteStore.getState().setPinned(true);

    expect(updateMock.mock.calls[0][0]).toMatchObject({ patch: { isPinned: true } });
    expect(useNoteStore.getState().note?.isPinned).toBe(true);
  });

  it('落盘失败：本地值回滚到点击前，并给出错误文案', async () => {
    updateMock.mockRejectedValue({
      code: 'DB_ERROR',
      message: '数据库操作失败: disk I/O error',
    });

    await useNoteStore.getState().setPinned(false);

    expect(useNoteStore.getState().note?.isPinned, '失败不得留下假置顶状态').toBe(true);
    expect(useNoteStore.getState().error).toBeTruthy();
  });

  it('无便利贴（note 为 null）时安全退出，不发 IPC', async () => {
    useNoteStore.setState({ note: null });
    await useNoteStore.getState().setPinned(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

/* [V0.11.2] 正文落盘的返回值契约：`closeNote` / 手机端 `finish` 全靠它决定关不关窗。
   同时锁住「只回填 savedContent、不回写 note.content」——否则落盘往返期间打的字会被
   服务端回声覆盖，下次「无变化」判定还会跳过保存，等于静默丢字。 */
describe('noteStore.saveContent', () => {
  it('成功返回 true，且不覆盖落盘期间的新输入', async () => {
    let resolveUpdate: (n: Note) => void = () => {};
    updateMock.mockReturnValue(
      new Promise<Note>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const pending = useNoteStore.getState().saveContent('第一版');
    /* 落盘往返期间用户还在打字 */
    useNoteStore.getState().setLocalContent('第一版 + 又打了几个字');
    resolveUpdate({ ...baseNote, content: '第一版' });

    await expect(pending).resolves.toBe(true);
    expect(useNoteStore.getState().savedContent).toBe('第一版');
    expect(useNoteStore.getState().note?.content, '本地正文不得被服务端回声覆盖').toBe(
      '第一版 + 又打了几个字',
    );
  });

  it('失败返回 false 并留错误文案（调用方据此不关窗）', async () => {
    updateMock.mockRejectedValue({ code: 'DB_ERROR', message: 'database is locked' });

    await expect(useNoteStore.getState().saveContent('新内容')).resolves.toBe(false);
    expect(useNoteStore.getState().error).toBeTruthy();
  });

  it('内容没变：返回 true 且不产生多余 IPC', async () => {
    await expect(useNoteStore.getState().saveContent(baseNote.content)).resolves.toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
