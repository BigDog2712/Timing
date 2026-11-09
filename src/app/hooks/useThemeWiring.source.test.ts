/**
 * 主题统一（D3）的**源码级**判据。
 *
 * 这一轮最容易错的地方不是渲染，是**接线**：主题值取对了、却把本地模式继续喂给就绪判据。
 * 后果不是"颜色不对"，而是主窗永远判定"没渲染好"——窗口能开、永远不显示，且不报错。
 * 纯函数测不到这种错误（`isDocumentThemeApplied` 自己是对的），只能钉调用现场：
 *
 * - `hasRenderableMainWindowFrame` 的第 2 个实参必须是 appliedThemeMode（按位置断言，
 *   只断言"某处出现过 appliedThemeMode"抓不到两实参对调）；
 * - effect 依赖里不许再出现裸的 `themeMode`，否则宿主换主题后判据不会重跑；
 * - `useAppThemeMode` 落 DOM 用的必须是 useHostThemeMode 的结果，不是入参。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读源码并去掉注释——注释里正当地写着 `themeMode`，拿注释当证据会让用例变成"谁删注释谁红"。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const READY = code('./useMainWindowReady.ts');
const APP_THEME = code('./useAppThemeMode.ts');

/* 函数**声明**和调用长得一样（`hasRenderableMainWindowFrame(`），先把声明改个名，
   下面匹配到的才是调用现场。 */
const READY_CALLS = READY.replace(/function hasRenderableMainWindowFrame/g, 'function __declared');
const APPLY_CALLS = APP_THEME.replace(/function applyDocumentTheme/g, 'function __declared');

describe('主窗就绪判据用的是实际生效的主题模式（D3）', () => {
  it("d3_ready_check_reads_applied_mode", () => {
    const call = /hasRenderableMainWindowFrame\(([\s\S]*?)\)/.exec(READY_CALLS);
    expect(call, '找不到 hasRenderableMainWindowFrame 调用').not.toBeNull();
    const args = call![1].split(',').map((arg) => arg.trim()).filter((arg) => arg.length > 0);

    expect(args[0]).toBe('frameRef.current');
    expect(args[1], '就绪判据必须比对实际生效的模式，否则宿主模式与本地不一致时窗口永不显示')
      .toBe('appliedThemeMode');
    expect(args[2]).toBe('colorSchemeLight');
    expect(args[3]).toBe('colorSchemeDark');
  });

  it("d3_ready_effect_depends_on_applied_mode", () => {
    const deps = READY.match(/\}, \[([^\]]*)\]\);/);
    expect(deps, '找不到 useMainWindowReady 的 effect 依赖数组').not.toBeNull();
    const list = deps![1].split(',').map((item) => item.trim());

    expect(list).toContain('appliedThemeMode');
    expect(list, '依赖里还留着裸的 themeMode：宿主换主题后判据不会重跑').not.toContain('themeMode');
  });
});

describe('落 DOM 用的是宿主模式（D3）', () => {
  it("d3_apply_uses_host_mode", () => {
    expect(APP_THEME).toContain('const appliedThemeMode = useHostThemeMode(themeMode)');

    const calls = APPLY_CALLS.match(/applyDocumentTheme\(\s*([A-Za-z]+)/g) ?? [];
    expect(calls.length, 'applyDocumentTheme 的调用点变了，这条判据需要跟着改').toBeGreaterThan(0);
    for (const snippet of calls) {
      const firstArg = snippet.replace(/applyDocumentTheme\(\s*/, '');
      expect(firstArg, 'applyDocumentTheme 的第一实参必须是实际生效的模式').toBe('appliedThemeMode');
    }
  });

  it("d3_settings_page_writes_back_to_host", () => {
    /* 去掉 import 行再断言：只留 import 不算接线（变异自证时踩过这个坑——
       删掉调用、import 还在，纯字符串断言照样绿）。 */
    const settings = code('../../features/settings/components/Settings.tsx')
      .replace(/^\s*import[^;]*;\s*$/gm, '');

    expect(settings, '设置页的主题开关必须真的写回宿主，不能只改本地 draft')
      .toContain('await writeHostThemeMode(');
    expect(settings, '主题选项还要接上 handleThemeModeChange（失败会回滚）')
      .toContain('void handleThemeModeChange(');
  });
});
