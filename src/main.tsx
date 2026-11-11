/**
 * Timing — 前端入口（只挂载 App，无业务）
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
/* [0.12.1] 手柄三形态：几何 + 关闭态 display:none + data-reveal 显形。
   必须在 surfaces.css 之后（同特异性靠顺序取胜，与 highlight.css 同一口径） */
import './styles/pill-handles.css';
/* [V0.11.0] 收起圆点（环 + 时间）：从 surfaces.css 拆出，守住单文件 ≤300 行 */
import './styles/dot.css';
import './styles/overlays.css';
import './styles/menu.css';
import './styles/panels.css';
/* [0.12.0] 同期电脑活动条（Patina 融合）：panels.css 已 258 行，单拆一份守住门禁 */
import './styles/activity-strip.css';
/* [0.12.1 T04b] 设置页搬进分析窗后，这 8 份样式也搬到了 `src/app/styles/features/host/`
   （分析窗的 `App.css` 里同样 @import 它们）。**宿主入口这里仍然要 import**：手机端
   （`src/components/mobile/SettingsPage.tsx`）复用旧的 GeneralTab / PluginsTab / ThemePicker
   与 `SyncPane`，它们用的还是同一批 className。桌面宿主窗已经不再渲染设置页，所以这几份
   在桌面包里是纯余量——留着是为了不把手机端的样式一起删掉。 */
import './app/styles/features/host/settings-dialog.css';
import './app/styles/features/host/settings-panel.css';
/* [V0.3.4] 插件页签样式（从 settings-panel.css 拆出，控制单文件行数） */
import './app/styles/features/host/settings-plugins.css';
/* [V0.4.0] Markdown 同步页签（md-sync 插件的落点配置） */
import './app/styles/features/host/settings-sync.css';
/* [V0.11.3] 同步间隔行（settings-sync.css 已到 299 行，单拆一份守住门禁） */
import './app/styles/features/host/settings-sync-interval.css';
/* [V0.11.13] 云端通道卡 + 备份卡（settings-sync.css 是本轮不许动的红线，新结构另起一份） */
import './app/styles/features/host/settings-sync-cloud.css';
/* [V0.11.15] 数据管理页签的壳：折叠块 / 底部 sticky 条 / 黄条 / 徽标（③④⑤ 仍用 sync__*） */
import './app/styles/features/host/settings-data.css';
/* [V0.11.16] 做完减法之后的那几个新位置（①的「今天」/③的聚合行与逐档提示/④三关/⑤当条记录） */
import './app/styles/features/host/settings-data-slim.css';
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
import './styles/mobile/items-done.css';
import './styles/mobile/records.css';
/* [V0.11.0] 便利贴页（第 5 个 Tab） */
import './styles/mobile/notes.css';
/* [V0.11.32] 结束未命名计时后补名字（独立一份，免得 sheets.css 撑破 300 行） */
import './styles/mobile/name-stop.css';
import './styles/mobile/settings.css';
import './styles/mobile/sheets.css';
import App from './App';
import { AppErrorBoundary, installGlobalErrorHooks } from './components/ui/AppErrorBoundary';
import { markWindowKind } from './lib/window';
import { installAppearanceSync } from './lib/appearanceSync';
import { initAppearance } from './stores/appearanceStore';
import { useUiStore } from './stores/uiStore';

/* 先把窗口类别写到 <html data-window>，使 CSS 在首帧即按窗切换根尺寸/底色（K-18） */
markWindowKind();

/* [V0.4.1] 渲染之外的异常（事件回调 / 未处理的 Promise）也要可见，不能静默 */
installGlobalErrorHooks();

/* [V0.2.2] 文字 / 背景不透明度：首帧即套用，避免先闪一帧全不透明 */
initAppearance();

/* [0.12.1] 跨窗同步：focus / pointerenter / visibilitychange 上幂等重读外观与手柄绑定。
   必须排在 initAppearance 之后（先有首帧外观，再谈"别窗改了要跟随"）。
   `storage` 事件在 WebView2 里跨顶层 WebView 不保证投递，所以主通道是"人回来就重读"。 */
installAppearanceSync();

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
