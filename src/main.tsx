/**
 * TickBar — 前端入口（只挂载 App，无业务）
 * 样式加载顺序：design-tokens（唯一裸色值来源）-> app -> surfaces -> panels。
 * design-tokens.css 本身是索引，内部按 §1~§6 顺序 @import ./tokens/*.css。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/design-tokens.css';
import './styles/design-tokens-compat.css';
import './styles/app.css';
import './styles/utilities.css';
import './styles/surfaces.css';
import './styles/overlays.css';
import './styles/menu.css';
import './styles/panels.css';
import './styles/settings-dialog.css';
import './styles/settings-panel.css';
/* [V0.3.4] 插件页签样式（从 settings-panel.css 拆出，控制单文件行数） */
import './styles/settings-plugins.css';
/* [V0.4.0] Markdown 同步页签（md-sync 插件的落点配置） */
import './styles/settings-sync.css';
/* [V0.4.1] 渲染异常兜底（透明窗里渲染抛错 = 药丸凭空消失，必须留住可点的界面） */
import './styles/error-boundary.css';
import './styles/theme-picker.css';
import './styles/slider.css';
import './styles/todos-panel.css';
import './styles/todos-pending.css';
import './styles/todos-inline.css';
/* [V0.3.9] 新增待办表单卡（与待办行样式分开，控制单文件行数） */
import './styles/todos-compose.css';
/* [V0.3.9] 待办时间字段 + 自绘日期时间选择浮层 */
import './styles/todos-datetime.css';
/* [V0.3.9] 事项窗左侧便利贴预览卡 */
import './styles/todos-preview.css';
import './styles/timer-window.css';
import './styles/note.css';
import './styles/batch2.css';
import './styles/reminder.css';
/* [V0.3.1] 高亮定位（必须在 surfaces.css 之后：与 .pill:hover 同特异性，靠顺序取胜） */
import './styles/highlight.css';
/* [V0.3.2] 摸鱼菜单（复用 menu.css 的玻璃语言，只补表单与大数字） */
import './styles/moyu.css';
/* [Android V1] 移动壳（类名 m-* / 变量 --m-*，与桌面零冲突；桌面产物里这几份样式
   仍会被打包，但没有 .m-shell 挂载点，规则不会命中任何元素）。
   按页面拆成 7 份是为了守住单文件 ≤300 行（AGENTS.md）。 */
import './styles/mobile/shell.css';
import './styles/mobile/primitives.css';
import './styles/mobile/timer.css';
import './styles/mobile/items.css';
import './styles/mobile/records.css';
import './styles/mobile/settings.css';
import './styles/mobile/sheets.css';
import App from './App';
import { AppErrorBoundary, installGlobalErrorHooks } from './components/ui/AppErrorBoundary';
import { markWindowKind } from './lib/window';
import { initAppearance } from './stores/appearanceStore';
import { useUiStore } from './stores/uiStore';

/* 先把窗口类别写到 <html data-window>，使 CSS 在首帧即按窗切换根尺寸/底色（K-18） */
markWindowKind();

/* [V0.4.1] 渲染之外的异常（事件回调 / 未处理的 Promise）也要可见，不能静默 */
installGlobalErrorHooks();

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
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
