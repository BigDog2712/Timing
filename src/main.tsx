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
import './styles/todos-panel.css';
import './styles/todos-pending.css';
import './styles/todos-inline.css';
import './styles/note.css';
import './styles/batch2.css';
import './styles/reminder.css';
import App from './App';
import { markWindowKind } from './lib/window';

/* 先把窗口类别写到 <html data-window>，使 CSS 在首帧即按窗切换根尺寸/底色（K-18） */
markWindowKind();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
