/**
 * `hostAccentBridge` 的防漂移判据（P0-01）。
 *
 * 三件事必须被钉死，否则「一套配色」会悄悄退回「两套近似配色」：
 *   1. **§4.3 的 8 行映射**：哪 6 个键由宿主覆盖、哪些键**必须保持预设**（danger /
 *      participation）、`bar` 不许参与——写成精确对象断言，多一个键少一个键都红。
 *   2. **浅色达标派生**：`accent_get` 返回的是用户原始值，宿主写入的是派生值。这里用
 *      固定输入向量断言**精确 hex**；派生算法一旦两侧不一致，值立刻变。
 *   3. **逐字同构**：`deepenFor*` 是从 `src/lib/theme.ts` 复制的（L9 禁 import 宿主根）。
 *      复制件与原件之间没有任何编译期约束，只能靠源码文本哨兵双向比对。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyHostAccents,
  deepenForNonText,
  deepenForText,
  type HostAccentColors,
} from './hostAccentBridge.ts';

const ACCENTS: HostAccentColors = {
  running: '#4DA3E8',
  warn: '#E8A33D',
  done: '#4CC38A',
  bar: '#0E0F12',
};

/* 令牌底座取 `deriveTheme('light'|'dark', 'default', null)` 的三个中性键真实值——
   换成随手写的假底色，就测不出「派生用的底色对不对」。 */
const DARK_TOKENS = { '--qp-bg-canvas': '#262626', '--qp-bg-panel': '#2d2d2d', '--qp-bg-elevated': '#2a2a2a' };
const LIGHT_TOKENS = { '--qp-bg-canvas': '#fbfbfb', '--qp-bg-panel': '#ffffff', '--qp-bg-elevated': '#f8f8f8' };

describe('applyHostAccents —— §4.3 的 8 行映射', () => {
  it("p001_dark_maps_six_keys_verbatim", () => {
    /* 深色：宿主直接用用户原值（与 `src/lib/theme.ts` 的 `applyAccents` 深色分支一致），
       只把 3 位缩写展开成 6 位小写，防 `primaryButtonBackground` 的 parse 算出 NaN。 */
    expect(applyHostAccents(DARK_TOKENS, ACCENTS, 'dark')).toEqual({
      '--qp-accent-default': '#4da3e8',
      '--qp-accent-muted': 'color-mix(in srgb, #4da3e8 20%, #262626)',
      '--qp-button-primary-bg': '#3a7bb0',
      '--qp-chart-cursor': 'color-mix(in srgb, #4da3e8 14%, transparent)',
      '--qp-success': '#4cc38a',
      '--qp-warning': '#e8a33d',
    });
  });

  it("p001_light_derives_for_contrast", () => {
    /* 浅色：running/done 作非文本 ≥3:1（对 `--qp-bg-panel` 亮度），warn 作文字 ≥4.5:1
       （对 `--qp-bg-elevated` 亮度）。下面每个 hex 都是派生算法的精确输出。 */
    expect(applyHostAccents(LIGHT_TOKENS, ACCENTS, 'light')).toEqual({
      '--qp-accent-default': '#4593D1',
      '--qp-accent-muted': 'color-mix(in srgb, #4593D1 14%, #fbfbfb)',
      '--qp-button-primary-bg': '#3a7bb0',
      '--qp-chart-cursor': 'color-mix(in srgb, #4593D1 12%, transparent)',
      '--qp-success': '#3E9F70',
      '--qp-warning': '#926726',
    });
  });

  it("p001_neutral_and_unsourced_keys_are_untouched", () => {
    const keys = Object.keys(applyHostAccents(LIGHT_TOKENS, ACCENTS, 'light'));
    /* 6 个 = 上限。多出来的一定是中性底色键被误覆盖（「28 套预设」边界线破了）。 */
    expect(keys).toHaveLength(6);
    /* 宿主没有 danger / participation 键 → 必须留给 `deriveTheme` 的预设值。 */
    expect(keys).not.toContain('--qp-danger');
    expect(keys).not.toContain('--qp-participation');
    /* `bar` 是药丸底板色，不参与分析窗令牌；这里不可能出现任何来自它的键。 */
    expect(keys).not.toContain('--qp-bar');
    expect(keys.filter((key) => !key.startsWith('--qp-'))).toEqual([]);
  });

  it("p001_no_accents_keeps_presets", () => {
    /* ACL 未就绪 / 宿主库未就绪：宁可整窗用预设色，也不能白屏。 */
    expect(applyHostAccents(LIGHT_TOKENS, null, 'light')).toEqual({});
  });

  it("p001_invalid_hex_is_ignored_per_key", () => {
    /* 一个坏色不许拖垮另外两个：`running` 非法 → 只少 4 个键，done/warn 照常生效。
       这条用例**故意**触发 dev 警告，所以把 console.warn 静音掉：让测试输出保持干净，
       避免 QA 把这条预期内的 stderr 当成失败信号（不能靠「反正只打一次」蒙过去）。 */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const overrides = applyHostAccents(
        LIGHT_TOKENS,
        { ...ACCENTS, running: '#GGGGGG' },
        'light',
      );
      expect(overrides).toEqual({ '--qp-success': '#3E9F70', '--qp-warning': '#926726' });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("p001_invalid_hex_warns_only_once", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      /* 用独占的坏值：模块里的去重集合是进程级的，别的用例用过的值不会再警告。 */
      const bad = { ...ACCENTS, done: 'rgb(1,2,3)' };
      applyHostAccents(DARK_TOKENS, bad, 'dark');
      applyHostAccents(DARK_TOKENS, bad, 'dark');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('"done"');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('deepenForNonText / deepenForText —— 与宿主算法同值', () => {
  /* 期望值是 `src/lib/theme.ts` 的实现算出来的；这里写死 hex，是为了「任何一侧被改动就红」。 */
  it("p001_deepen_for_non_text_vectors", () => {
    expect(deepenForNonText('#4DA3E8', 1, 3)).toBe('#4593D1');
    expect(deepenForNonText('#4CC38A', 1, 3)).toBe('#3E9F70');
    expect(deepenForNonText('#E8A33D', 1, 3)).toBe('#BD8532');
    /* 3 位缩写走同一路径（`hexToRgb` 会展开）。 */
    expect(deepenForNonText('#abc', 1, 3)).toBe('#84919E');
    /* 已经达标的值原样返回（大小写按实现转大写）。 */
    expect(deepenForNonText('#171717', 1, 3)).toBe('#171717');
  });

  it("p001_deepen_for_text_vectors", () => {
    const plateLum = 0.938685728457888;
    expect(deepenForText('#E8A33D', plateLum, 4.5)).toBe('#926726');
    expect(deepenForText('#4DA3E8', plateLum, 4.5)).toBe('#3672A2');
    /* 与 nonText 同一算法，只有默认目标不同：同一输入、目标 4.5 比目标 3 更深。 */
    expect(deepenForNonText('#4DA3E8', 1, 4.5)).toBe('#3978AB');
    expect(deepenForNonText('#4DA3E8', 1, 3)).not.toBe(deepenForNonText('#4DA3E8', 1, 4.5));
  });

  it("p001_invalid_hex_passes_through", () => {
    expect(deepenForNonText('#12345', 1, 3)).toBe('#12345');
    expect(deepenForText('', 1, 4.5)).toBe('');
  });
});

describe('逐字同构哨兵（复制件 vs 宿主原件）', () => {
  /* 只做**文本**比对，不执行宿主代码——L9 禁止的是 import，不是读文件。
     宁可这里失败，也不要「两边悄悄分叉」：分叉的症状是浅色下两个窗的主色差一档，
     没人会想到去查 theme.ts。 */
  const normalize = (source: string) => source.replace(/isValidHex/g, 'isValidHostHex').replace(/'/g, '"');
  /* 相对路径必须走**变量**：`new URL('字面量', import.meta.url)` 会被 Vite 当成静态资源
     改写成 dev server 的 http URL，`readFileSync` 直接抛 ERR_INVALID_URL_SCHEME。 */
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  const host = normalize(read('../../lib/theme.ts'));
  const bridge = normalize(read('./hostAccentBridge.ts'));

  const SHARED_LINES = [
    'function hexToRgb(hex: string): { r: number; g: number; b: number } {',
    'const raw = hex.trim().slice(1);',
    'const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;',
    'return clamped.toString(16).padStart(2, "0");',
    'return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);',
    'return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b);',
    'return (hi + 0.05) / (lo + 0.05);',
    'export function deepenForNonText(hex: string, bgLum: number, target = 3): string {',
    'if (!isValidHostHex(hex)) return hex;',
    'for (let i = 0; i < 24; i += 1) {',
    'if (contrast(relLum(r, g, b), bgLum) >= target) break;',
    'r *= 0.95;',
    'g *= 0.95;',
    'b *= 0.95;',
    'export function deepenForText(hex: string, bgLum: number, target = 4.5): string {',
    'return deepenForNonText(hex, bgLum, target);',
  ];

  it("p001_copy_is_byte_identical_to_host", () => {
    for (const line of SHARED_LINES) {
      expect(host, `宿主 src/lib/theme.ts 少了这行，哨兵失效：${line}`).toContain(line);
      expect(bridge, `hostAccentBridge.ts 没对齐宿主这一行（逐字同构要求）：${line}`).toContain(line);
    }
  });

  it("p001_light_baselines_match_host", () => {
    /* 两块基准底：非文本对 `--bg-panel`（浅色 = 纯白），文字对 `--bg-plate`（#f2f3f5）。
       分析窗的等比回落值必须与之一致，否则同一份 bad 色两边算出的深度不同。 */
    for (const line of ['const panelLum = relLum(255, 255, 255);', 'const plateLum = relLum(242, 243, 245);']) {
      expect(host, `宿主 applyAccents 的基准底改了：${line}`).toContain(line);
    }
    expect(bridge).toContain('const PANEL_LUM_FALLBACK = relLum(255, 255, 255);');
    expect(bridge).toContain('const PLATE_LUM_FALLBACK = relLum(242, 243, 245);');
    /* 宿主按「warn 作文字、其余作非文本」分档；分析窗的分档必须一样。 */
    expect(host).toContain(
      'key === "warn" ? deepenForText(value, plateLum) : deepenForNonText(value, panelLum)',
    );
  });
});
