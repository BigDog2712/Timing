// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEVICE_COLOR_TOKENS,
  deviceColor,
  deviceColorIndex,
  fnv1a32,
} from "./deviceColor.ts";

/**
 * 设备色**必须是令牌引用**，而且那 8 个令牌必须真实存在。
 *
 * 为什么要读 CSS 文件断言：`deviceColor()` 返回 `var(--at-device-3)` 这种字符串，
 * 少定义一个令牌**不会报错**——那个圆点会静默变成透明或继承父色，看起来只是"颜色不对"。
 * 这类缺陷在 jsdom 里也测不出来（不做样式计算），所以只能直接查源文件。
 *
 * `?raw` 读不了 CSS（Vite 对 `.css?raw` 也走 CSS 管线），样式判据用 `readFileSync`。
 * 路径**必须经变量**传进 `new URL`：写成 `new URL("…字面量…", import.meta.url)` 会被 Vite
 * 静态改写成 `http://localhost:3000/…` 资源地址，届时 fs 报 "URL must be of scheme file"。
 */
function readCss(rel: string): string {
  /* **必须剥注释**：本文件头注释里写着 `:root[data-theme="dark"]`，不剥的话
     「暗色块排在浅色块之后」那条断言会抓到注释里的第一次出现（索引更小），永远红。 */
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = readCss("../../shell/styles/features/device-lanes.css");

describe("deviceColor 只返回令牌引用", () => {
  it("非空 id 一律形如 var(--at-device-N)，N 在 0..7", () => {
    for (const id of ["b265fafdc306", "a1b2c3d4e5f6", "x", "微信", "000000"]) {
      const color = deviceColor(id);
      expect(color).toMatch(/^var\(--at-device-[0-7]\)$/);
    }
  });

  it("确定性：同一台设备永远同一个令牌，且与哈希取模一致", () => {
    const id = "b265fafdc306";
    expect(deviceColor(id)).toBe(`var(--at-device-${fnv1a32(id) % DEVICE_COLOR_TOKENS})`);
    expect(deviceColorIndex(id)).toBe(fnv1a32(id) % DEVICE_COLOR_TOKENS);
  });

  it("FNV-1a 32 位有确定的已知值（换算法就必须改这里）", () => {
    expect(fnv1a32("")).toBe(0x811c_9dc5);
    expect(fnv1a32("a")).toBe(Math.imul(0x811c_9dc5 ^ 0x61, 0x0100_0193) >>> 0);
  });

  it("空 id 给中性令牌，不占色相槽", () => {
    expect(deviceColor("   ")).toBe("var(--at-text-tertiary)");
  });
});

describe("device-lanes.css 的令牌真的存在（浅/深两套）", () => {
  it("8 个令牌在文件里各定义两次（:root 与 :root[data-theme=\"dark\"]）", () => {
    for (let index = 0; index < DEVICE_COLOR_TOKENS; index += 1) {
      const defined = CSS.match(new RegExp(`--at-device-${index}\\s*:`, "g")) ?? [];
      expect(defined.length, `--at-device-${index} 的定义次数（浅/深各一次）`).toBe(2);
    }
  });

  it("没有任何超出 0..7 的令牌被定义（多定义即浪费且易与色相表错位）", () => {
    const all = [...CSS.matchAll(/--at-device-(\d+)\s*:/g)].map((match) => Number(match[1]));
    expect(new Set(all)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it("两个色块都在（浅色 :root 与暗色 [data-theme=\"dark\"]）", () => {
    expect(CSS).toContain(':root[data-theme="dark"]');
    /* 暗色块必须排在浅色块之后：同名令牌后者覆盖前者 */
    expect(CSS.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(CSS.indexOf("--at-device-0"));
  });
});
