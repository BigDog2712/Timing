/**
 * Timing — 应用图标的兜底判据（[0.13.7]）
 * -----------------------------------------------------------------------------
 * 真机现象（0.12.6 用户反馈「图标无法正常加载」）：图标位置是一块**灰底空白**。
 *
 * 原因是 `.m-usage__icon` 自带 `background: var(--bg-field)` ——
 * 只要 `<img>` 挂了但图没画出来（数据坏了、解码失败、CSP 挡了 `data:`），
 * 看到的就是一块规规矩矩的灰方块，和「正在加载」长得一模一样，而且永远不结束。
 *
 * 所以「`icon` 非空 ⇒ 画 `<img>`」这条规则不够：**加载失败必须能退回瓦片**。
 * 纯函数判据测不到这件事（它只在真 DOM 的事件里发生），只能真挂一次。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/* 没有它，`act(...)` 只发警告不生效：断言会在 React 还没刷完时就跑，红/绿都不可信。 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { UsageAppIcon } from './UsageAppIcon';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

/** 挂一个图标，返回容器里那个 `<img>`（没有就抛，报错信息比断言更直白）。 */
function mount(label: string, icon?: string): HTMLImageElement | null {
  act(() => {
    root.render(createElement(UsageAppIcon, { label, icon }));
  });
  return container.querySelector('img');
}

describe('图标加载失败要退回首字瓦片', () => {
  it('rd06_broken_image_falls_back_to_letter_tile', () => {
    const img = mount('微信', 'data:image/webp;base64,%%%not-a-real-image');
    if (img == null) throw new Error('有 icon 时应当先渲染 <img>');

    /* 真机上这一步由 WebView 自己发；这里手动发一个，等价于「解码失败」 */
    act(() => {
      img.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('img'), '破图还留着 —— 界面上就是一块灰底空白').toBeNull();
    expect(container.textContent, '没有退回首字瓦片').toBe('微');
  });

  it('rd07_good_icon_keeps_the_image', () => {
    const img = mount('抖音', 'data:image/webp;base64,AAAA');
    if (img == null) throw new Error('有 icon 时应当渲染 <img>');
    expect(img.getAttribute('src')).toBe('data:image/webp;base64,AAAA');
    /* `alt=""`：名字就在旁边，读屏再念一遍图标是噪音 */
    expect(img.getAttribute('alt')).toBe('');
    expect(container.textContent, '有图时不该同时画出瓦片').toBe('');
  });

  it('rd08_no_icon_renders_the_tile', () => {
    expect(mount('哔哩哔哩', ''), '空 icon 不该渲染 img').toBeNull();
    expect(container.textContent).toBe('哔');
    expect(container.querySelector('.m-usage__icon--letter')).not.toBeNull();
  });

  it('rd09_new_icon_gets_a_second_chance', () => {
    const first = mount('微信', 'data:image/webp;base64,broken');
    if (first == null) throw new Error('第一次应当渲染 <img>');
    act(() => {
      first.dispatchEvent(new Event('error'));
    });
    expect(container.textContent).toBe('微');

    /* 补算完更早的一天，图标换成一张好的：不能因为上次失败就永久钉成瓦片 */
    const next = mount('微信', 'data:image/webp;base64,AAAA');
    if (next == null) throw new Error('换了好图标之后应当重新渲染 <img>');
    expect(next.getAttribute('src')).toBe('data:image/webp;base64,AAAA');
  });
});
