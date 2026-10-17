/**
 * TickBar — 前端入口（只挂载 App，无业务）
 * 样式加载顺序：design-tokens（唯一裸色值来源）-> app -> surfaces -> panels。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/design-tokens.css';
import './styles/design-tokens-compat.css';
import './styles/app.css';
import './styles/surfaces.css';
import './styles/overlays.css';
import './styles/menu.css';
import './styles/panels.css';
import './styles/settings-dialog.css';
import './styles/settings-panel.css';
import './styles/theme-picker.css';
import './styles/slider.css';
import './styles/todos-panel.css';
import './styles/todos-pending.css';
import './styles/todos-inline.css';
import './styles/timer-window.css';
import './styles/note.css';
import './styles/batch2.css';
import './styles/reminder.css';
import App from './App';
import { markWindowKind } from './lib/window';
import { initAppearance } from './stores/appearanceStore';
import { useUiStore } from './stores/uiStore';

/* 先把窗口类别写到 <html data-window>，使 CSS 在首帧即按窗切换根尺寸/底色（K-18） */
markWindowKind();

/* [V0.2.2] 文字 / 背景不透明度：首帧即套用，避免先闪一帧全不透明 */
initAppearance();

/* 屏蔽 WebView2 的原生右键菜单：桌面版里它会弹出「重新加载 / 检查」一类浏览器菜单，
   与自绘的右键菜单（小条 / 便利贴手柄）冲突。捕获阶段只 preventDefault、不 stopPropagation，
   组件自己的 contextmenu 处理照常执行。 */
document.addEventListener('contextmenu', (e) => e.preventDefault(), true);

/* [V0.2.4 · 3] 窗口失焦即收起所有浮层：小条窗口只有 384×360，`--menu-scrim` 只覆盖本窗口，
   用户点到窗口外的桌面时事件根本进不来，菜单就会「点一下关不掉、要点好几下」。
   失焦（点桌面 / 切到别的程序 / 点到便利贴窗）代表菜单的使用语境已经结束，直接清浮层。 */
window.addEventListener('blur', () => {
  useUiStore.getState().resetTransient();
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
