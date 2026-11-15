import { describe, expect, it, vi } from "vitest";
import { createHostThemeSync, type HostThemeSyncDeps } from "./hostThemeGateway.ts";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";

/**
 * 主题同步器（D3）的两条竞态。
 *
 * 这两条不是"边界情况"：宿主主题在窗口打开时往往正好被另一条窗改过，
 * 读回来的旧值盖掉新事件，症状就是「主窗深色、分析窗停在浅色，重启才恢复」。
 */

const tick = () => new Promise<void>((resolve) => {
  setTimeout(resolve, 0);
});

function buildDeps(overrides: Partial<HostThemeSyncDeps> = {}) {
  const applied: ThemeMode[] = [];
  const deps: HostThemeSyncDeps = {
    read: async () => null,
    subscribe: async () => null,
    apply: (mode) => {
      applied.push(mode);
    },
    ...overrides,
  };
  return { deps, applied };
}

describe("createHostThemeSync", () => {
  it("没有事件时按读回来的模式应用一次", async () => {
    const { deps, applied } = buildDeps({ read: async () => "dark" });

    createHostThemeSync(deps);
    await tick();

    expect(applied).toEqual(["dark"]);
  });

  it("事件先到、读回来的旧值不能盖掉它", async () => {
    const { deps, applied } = buildDeps({
      subscribe: async (onMode) => {
        onMode("dark");
        return null;
      },
      read: async () => "light",
    });

    createHostThemeSync(deps);
    await tick();

    expect(applied).toEqual(["dark"]);
  });

  it("读不到宿主模式时不应用任何东西（由调用方回落本地设置）", async () => {
    const { deps, applied } = buildDeps({
      subscribe: async () => null,
      read: async () => null,
    });

    createHostThemeSync(deps);
    await tick();

    expect(applied).toEqual([]);
  });

  it("订阅不可用不影响读取", async () => {
    const { deps, applied } = buildDeps({
      subscribe: async () => null,
      read: async () => "system",
    });

    createHostThemeSync(deps);
    await tick();

    expect(applied).toEqual(["system"]);
  });

  it("取消之后事件不再应用，且取消订阅被调用", async () => {
    /* 用对象装回调：`let x; 闭包里赋值` 会让 TS 的控制流分析把外面仍当成 null。 */
    const harness: { push: ((mode: ThemeMode) => void) | null } = { push: null };
    const unlisten = vi.fn();
    const { deps, applied } = buildDeps({
      subscribe: async (onMode) => {
        harness.push = onMode;
        return unlisten;
      },
      read: async () => null,
    });

    const stop = createHostThemeSync(deps);
    await tick();
    expect(harness.push).not.toBeNull();

    stop();
    harness.push?.("dark");
    await tick();

    expect(applied).toEqual([]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("订阅还没返回就取消时，晚到的取消函数也要被调用", async () => {
    const unlisten = vi.fn();
    const { deps } = buildDeps({
      subscribe: () => new Promise((resolve) => {
        setTimeout(() => resolve(unlisten), 0);
      }),
    });

    const stop = createHostThemeSync(deps);
    stop();
    await tick();
    await tick();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
