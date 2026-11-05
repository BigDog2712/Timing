/**
 * Timing — 便利贴预览卡几何（V0.3.9）
 * -----------------------------------------------------------------------------
 * 卡片画在事项窗左侧透明区：竖直方向贴住被悬停的行，且始终落在视口内
 * （WebView 只画窗口内，出界会被裁）。这三条行为就是本文件的断言。
 */
import { describe, expect, it } from 'vitest';
import { NOTE_PREVIEW_MAX_H, NOTE_PREVIEW_W, notePreviewBox } from './notePreview';

describe('notePreviewBox', () => {
  it('贴住悬停行：顶边约等于行 top（去掉一点留白）', () => {
    const box = notePreviewBox(200, 560);
    expect(box.top).toBeGreaterThanOrEqual(196);
    expect(box.top).toBeLessThanOrEqual(200);
    expect(box.left).toBe(8);
    expect(box.width).toBe(NOTE_PREVIEW_W);
    expect(box.maxHeight).toBe(NOTE_PREVIEW_MAX_H);
  });

  it('行在视口顶部时不会顶出窗口', () => {
    expect(notePreviewBox(0, 560).top).toBe(8);
    expect(notePreviewBox(-40, 560).top).toBe(8);
  });

  it('行在视口底部时卡片往上收，底边不出窗口', () => {
    const vh = 560;
    const box = notePreviewBox(vh - 6, vh);
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(vh - 8);
  });
});
