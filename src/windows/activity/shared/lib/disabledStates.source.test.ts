// @ts-expect-error Project intentionally has no @types/node; Vitest executes this in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const TOKENS = readSource("../../shell/styles/tokens.css");
const STATES = readSource("../../shell/styles/disabled-states.css");
const APP_CSS = readSource("../../shell/App.css");
const RESPONSIVE = readSource("../../shell/styles/features/data-layout-responsive.css");
const QUIET_PRO = readSource("../../shell/styles/quiet-pro.css");
const DENSITY = readSource("../../shell/styles/nonboard-density.css");

describe("大窗剩余 UI 规范", () => {
  it("浅色禁用文字用 tertiary，深色禁用文字纯白且背景回落 panel", () => {
    expect(TOKENS).toContain("--at-disabled-text: var(--at-text-tertiary)");
    expect(TOKENS).toContain('--at-disabled-text: #ffffff');
    expect(TOKENS.match(/--at-disabled-bg:\s*var\(--at-bg-panel\)/g)).toHaveLength(2);
    expect(STATES).toContain(":disabled");
    expect(STATES).toContain("opacity: 1");
    expect(STATES).toContain(":disabled:not(.at-switch)");
    expect(STATES).toContain(":not(.at-switch):not(.at-segmented-filter-item)");
  });

  it("指标条按目的地面板容器宽度切换 2/3/4 列，不依赖首页网格", () => {
    expect(RESPONSIVE).toContain("container: data-destination / inline-size");
    expect(RESPONSIVE).toContain("@container data-destination (max-width: 639px)");
    expect(RESPONSIVE).toContain("repeat(2, minmax(0, 1fr))");
    expect(RESPONSIVE).toContain("@container data-destination (min-width: 640px) and (max-width: 899px)");
    expect(RESPONSIVE).toContain("repeat(3, minmax(0, 1fr))");
    expect(RESPONSIVE).toContain(".data-app-metric:nth-child(4)");
    expect(RESPONSIVE).toContain("border-left: 0");
    expect(QUIET_PRO).toContain("repeat(4, minmax(0, 1fr))");
    expect(RESPONSIVE).not.toContain(".at-grid");
  });

  it("非画布视图在窄窗收紧留白，首页画布保持独立缩放", () => {
    expect(DENSITY).toContain("@media (max-width: 1039px)");
    expect(DENSITY).toContain('.at-canvas:not([data-presented-view="dashboard"])');
    expect(DENSITY).toContain("padding: 12px");
    expect(DENSITY).toContain("gap: 12px");
    expect(DENSITY).not.toContain(".at-main-view");
  });

  it("统一禁用样式最后加载，覆盖存量组件透明度规则", () => {
    expect(APP_CSS.indexOf("disabled-states.css")).toBeGreaterThan(APP_CSS.indexOf("dashboard-r2-cards.css"));
    expect(STATES).toContain(".sync__card[data-disabled=\"true\"]");
    expect(STATES).toContain(".settings-dialog-action-composite[data-disabled=\"true\"]");
  });

  it("首页计时环心是唯一 display 档 Primary，使用现有 24px metric token", () => {
    const dashboardModules = readSource("../../shell/styles/features/dashboard-modules.css");
    expect(dashboardModules).toContain(".at-donut-total");
    expect(dashboardModules).toContain("font-size: var(--at-font-size-metric)");
    expect(dashboardModules).toContain("line-height: var(--at-line-height-metric)");
    expect(dashboardModules).not.toContain("font-size: clamp(");
  });
});
