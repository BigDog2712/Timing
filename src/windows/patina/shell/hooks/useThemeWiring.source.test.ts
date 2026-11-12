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

describe('落 DOM 用的是宿主模式（D3 + P0-01）', () => {
  it("d3_apply_uses_host_mode", () => {
    /* 一条语句同时取模式与四色：宿主是唯一真相，本地 `themeMode` 只作回落值。
       拆成两次 hook 调用会订阅两遍，也会让两条竞态各写一份（见 hostThemeGateway）。 */
    expect(APP_THEME).toContain('const { mode: appliedThemeMode, accents: hostAccents } = useHostTheme(themeMode)');

    const calls = APPLY_CALLS.match(/applyDocumentTheme\(\s*([A-Za-z]+)/g) ?? [];
    expect(calls.length, 'applyDocumentTheme 的调用点变了，这条判据需要跟着改').toBeGreaterThan(0);
    for (const snippet of calls) {
      const firstArg = snippet.replace(/applyDocumentTheme\(\s*/, '');
      expect(firstArg, 'applyDocumentTheme 的第一实参必须是实际生效的模式').toBe('appliedThemeMode');
    }
  });

  it("p001_apply_passes_host_accents", () => {
    /* 每个落 DOM 的调用点都必须把宿主四色传进去，否则强调色退回预设（= 两套配色）。
       覆盖顺序是 deriveTheme → applyHostAccents → 写 DOM → 活动色，见 ARCH §4.3 注 1。 */
    const calls = APPLY_CALLS.match(/applyDocumentTheme\([\s\S]*?\);/g) ?? [];
    expect(calls.length, 'applyDocumentTheme 的调用点变了，这条判据需要跟着改').toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, '调用 applyDocumentTheme 时漏传了宿主四色').toContain('hostAccents');
    }
    expect(APP_THEME, '四色变化必须重跑落 DOM 的 effect，否则改色后分析窗不跟手')
      .toContain('appliedThemeMode, hostAccents ]');

    const order = ['deriveTheme(', 'applyHostAccents(', 'root.style.setProperty(', 'applyActivityDisplayTheme(']
      .map((needle) => APP_THEME.indexOf(needle));
    expect(order.every((index) => index >= 0), 'applyDocumentTheme 里少了某一步').toBe(true);
    expect(order, '覆盖顺序必须是 deriveTheme → applyHostAccents → setProperty → 活动色').toEqual(
      [...order].sort((a, b) => a - b),
    );
  });

});

/**
 * P0-06 把上面那条用例**反过来**了，所以单独开一组，免得混在 D3 里看不出是故意的。
 *
 * 原断言是「设置页的主题开关必须真的写回宿主」——那时分析窗还有自己的深/浅开关。
 * P0-06 判定那个开关正是「两个 App」感的来源，已整体下线：深/浅的唯一真相是宿主，
 * 分析窗只读。写回能力仍留在 `platform/runtime/hostThemeGateway.ts`（当前零调用，
 * 等 P0-05 的 intent 通道），因此这里断的是「设置页一次都不许碰它」。
 */
describe('P0-06：设置页不再写回宿主主题（D3 的收口）', () => {
  it("p006_settings_page_no_longer_writes_host_theme", () => {
    /* 去掉 import 行再断言：只留 import 不算接线（变异自证时踩过这个坑——
       删掉调用、import 还在，纯字符串断言照样绿）。 */
    const settings = code('../../features/settings/components/Settings.tsx')
      .replace(/^\s*import[^;]*;\s*$/gm, '');

    expect(settings, '分析窗设置页不许再写回宿主主题（P0-06：那个开关已下线）')
      .not.toContain('writeHostThemeMode');
    expect(settings, 'handleThemeModeChange 应随开关一起删干净')
      .not.toContain('handleThemeModeChange');
    /* 但 D3 的接线本身还在（不是把这块整段删掉换绿）：落 DOM 仍认宿主值。 */
    expect(APP_THEME, '落 DOM 仍然必须用宿主模式，别为了删开关把 D3 一起拆了')
      .toContain('useHostTheme(');
  });
});
