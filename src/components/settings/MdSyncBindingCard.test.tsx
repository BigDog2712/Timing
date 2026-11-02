import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MdSyncBinding, MdSyncBindingStatus } from '../../types/domain';
import { MdSyncBindingCard } from './MdSyncBindingCard';

const BINDING: MdSyncBinding = {
  kind: 'timers',
  enabled: true,
  root: 'C:\\Vault',
  file: 'Diary/{yyyy}/{date}.md',
  heading: '#### 事项计时',
};

function render(status?: MdSyncBindingStatus, binding: MdSyncBinding = BINDING): string {
  return renderToStaticMarkup(
    createElement(MdSyncBindingCard, {
      binding,
      status,
      today: '2026-10-20',
      disabled: false,
      onChange: () => undefined,
      onPick: () => undefined,
      onOpen: () => undefined,
    }),
  );
}

describe('MdSyncBindingCard —— 落点预览与状态', () => {
  it('把日期令牌展开成今天，预览的是草稿而不是上次同步的旧路径', () => {
    const html = render();
    expect(html).toContain('C:\\Vault\\Diary/2026/2026-10-20.md');
    expect(html).toContain('尚未同步');
  });

  it('上次失败时展示后端原因，并把状态标红', () => {
    const html = render({
      kind: 'timers',
      path: 'C:\\Vault\\2026-10-20.md',
      exists: false,
      lastError: '落点不是文件',
      lastSyncAt: Date.now(),
      lastDirection: null,
    });
    expect(html).toContain('上次同步失败');
    expect(html).toContain('落点不是文件');
    expect(html).toContain('data-error="true"');
  });

  it('关闭该种类同步时字段自动收纳，保留图标按钮可展开', () => {
    const html = render(undefined, { ...BINDING, enabled: false });
    expect(html).toMatch(/id="md-sync-timers"[^>]*hidden=""/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('展开事项计时设置');
  });

  it('导入方向显示为从 Markdown 导入', () => {
    const html = render({
      kind: 'timers',
      path: 'C:\\Vault\\2026-10-20.md',
      exists: true,
      lastError: null,
      lastSyncAt: Date.now(),
      lastDirection: 'import',
    });
    expect(html).toContain('已从 Markdown 导入');
  });
});
