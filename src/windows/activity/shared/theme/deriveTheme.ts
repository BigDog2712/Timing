import type { ColorScheme } from "../settings/appSettings.ts";
import { effectiveThemeContrast, getThemePreset, type ThemeVariant } from "./themePresets.ts";

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const parse = (hex: string): RGB => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as RGB;
const mix = (from: RGB, to: RGB, amount: number): RGB => from.map((channel, index) => Math.round(channel + (to[index] - channel) * clamp(amount))) as RGB;
const hex = (rgb: RGB) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const solid = (rgb: RGB) => `rgb(${rgb.join(", ")})`;

function contrastWithWhite(rgb: RGB): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] + 0.05);
}

export function primaryButtonBackground(accent: string): string {
  const rgb = parse(accent);
  if (contrastWithWhite(rgb) >= 4.5) return accent;
  let insufficient = 0;
  let sufficient = 1;
  // Search rounded sRGB blends; the tiny margin never rounds a failing WCAG ratio up.
  for (let step = 0; step < 24; step += 1) {
    const amount = (insufficient + sufficient) / 2;
    if (contrastWithWhite(mix(rgb, BLACK, amount)) >= 4.5001) sufficient = amount;
    else insufficient = amount;
  }
  return hex(mix(rgb, BLACK, sufficient));
}

// Contrast shaping is intentionally unclamped; clamp only channel blends and alpha.
function shapeContrast(value: number, dark: boolean): number {
  const baseline = dark ? 60 : 45;
  const shaped = value / 100 + (value - baseline) / 60 * 0.7;
  return value <= baseline ? shaped : baseline / 100 + (shaped - baseline / 100) * 2;
}

const DEFAULT_CONTROLS: Record<ThemeVariant, Record<string, string>> = {
  "light": {
    "--at-bg-app": "#f4f4f4",
    "--at-bg-canvas": "#fbfbfb",
    "--at-bg-panel": "#ffffff",
    "--at-bg-elevated": "#f8f8f8",
    "--at-text-primary": "#171717",
    "--at-text-secondary": "#434343",
    "--at-text-tertiary": "#707070",
    "--at-accent-default": "#315f9f",
    "--at-accent-muted": "#e8eef6",
    "--at-success": "#2f7d49",
    "--at-participation": "#3f74c2",
    "--at-warning": "#9a6700",
    "--at-danger": "#b53a3a",
    "--at-control-off": "#d2d2d2",
    "--at-track-muted": "#e6e6e6",
    "--at-badge-subtle": "#f1f1f1",
    "--at-text-disabled": "#adadad",
    "--at-scrollbar-default": "#cccccc",
    "--at-scrollbar-hover": "#b8b8b8",
    "--at-control-thumb": "#ffffff",
    "--at-chart-cursor": "rgba(101, 114, 135, 0.12)",
    "--at-chart-grid": "rgba(156, 168, 186, 0.25)"
  },
  "dark": {
    "--at-bg-app": "#212121",
    "--at-bg-canvas": "#262626",
    "--at-bg-panel": "#2d2d2d",
    "--at-bg-elevated": "#2a2a2a",
    "--at-text-primary": "#d1d5dc",
    "--at-text-secondary": "#adb3bd",
    "--at-text-tertiary": "#7f8791",
    "--at-accent-default": "#8ba1c0",
    "--at-accent-muted": "#333b46",
    "--at-success": "#82ad8b",
    "--at-participation": "#93a9c8",
    "--at-warning": "#c19b5c",
    "--at-danger": "#c98383",
    "--at-control-off": "#555555",
    "--at-track-muted": "#484848",
    "--at-badge-subtle": "#3a3a3a",
    "--at-text-disabled": "#6f7680",
    "--at-scrollbar-default": "#545454",
    "--at-scrollbar-hover": "#686868",
    "--at-control-thumb": "#bdc6d1",
    "--at-chart-cursor": "rgba(127, 135, 145, 0.12)",
    "--at-chart-grid": "rgba(127, 135, 145, 0.1)"
  }
};

function controlColors(variant: ThemeVariant, scheme: ColorScheme): Record<string, string> {
  if (scheme === "default") return DEFAULT_CONTROLS[variant];
  const p = getThemePreset(variant, scheme);
  return variant === "dark" ? {
    "--at-text-primary": `${p.ink}`,
    "--at-text-secondary": `color-mix(in srgb, ${p.ink} 78%, ${p.surface})`,
    "--at-text-tertiary": `color-mix(in srgb, ${p.ink} 56%, ${p.surface})`,
    "--at-accent-default": `${p.accent}`,
    "--at-accent-muted": `color-mix(in srgb, ${p.accent} 20%, ${p.surface})`,
    "--at-success": `${p.semanticColors.diffAdded}`,
    "--at-participation": `${p.semanticColors.skill}`,
    "--at-warning": `color-mix(in srgb, ${p.accent} 52%, #d29922)`,
    "--at-danger": `${p.semanticColors.diffRemoved}`,
    "--at-control-off": `color-mix(in srgb, ${p.surface} 62%, ${p.ink})`,
    "--at-track-muted": `color-mix(in srgb, ${p.surface} 72%, ${p.ink})`,
    "--at-badge-subtle": `color-mix(in srgb, ${p.surface} 86%, ${p.ink})`,
    "--at-text-disabled": `color-mix(in srgb, ${p.ink} 34%, ${p.surface})`,
    "--at-scrollbar-default": `color-mix(in srgb, ${p.surface} 60%, ${p.ink})`,
    "--at-scrollbar-hover": `color-mix(in srgb, ${p.surface} 46%, ${p.ink})`,
    "--at-control-thumb": `${p.ink}`,
    "--at-chart-cursor": `color-mix(in srgb, ${p.accent} 14%, transparent)`,
    "--at-chart-grid": `color-mix(in srgb, ${p.ink} 12%, transparent)`,
  } : {
    "--at-text-primary": `${p.ink}`,
    "--at-text-secondary": `color-mix(in srgb, ${p.ink} 76%, ${p.surface})`,
    "--at-text-tertiary": `color-mix(in srgb, ${p.ink} 56%, ${p.surface})`,
    "--at-accent-default": `${p.accent}`,
    "--at-accent-muted": `color-mix(in srgb, ${p.accent} 12%, ${p.surface})`,
    "--at-success": `${p.semanticColors.diffAdded}`,
    "--at-participation": `${p.semanticColors.skill}`,
    "--at-warning": `color-mix(in srgb, ${p.accent} 64%, #b58900)`,
    "--at-danger": `${p.semanticColors.diffRemoved}`,
    "--at-control-off": `color-mix(in srgb, ${p.surface} 88%, ${p.ink})`,
    "--at-track-muted": `color-mix(in srgb, ${p.surface} 95%, ${p.ink})`,
    "--at-badge-subtle": `color-mix(in srgb, ${p.surface} 96%, ${p.accent})`,
    "--at-text-disabled": `color-mix(in srgb, ${p.ink} 38%, ${p.surface})`,
    "--at-scrollbar-default": `color-mix(in srgb, ${p.surface} 86%, ${p.ink})`,
    "--at-scrollbar-hover": `color-mix(in srgb, ${p.surface} 76%, ${p.ink})`,
    "--at-control-thumb": "#ffffff",
    "--at-chart-cursor": `color-mix(in srgb, ${p.accent} 12%, transparent)`,
    "--at-chart-grid": `color-mix(in srgb, ${p.ink} 18%, transparent)`,
  };
}

/** Corrected theme surfaces with Patina control colors and interaction hierarchy. */
export function deriveTheme(variant: ThemeVariant, scheme: ColorScheme, override: number | null): Record<string, string> {
  const p = getThemePreset(variant, scheme);
  const dark = variant === "dark";
  const value = effectiveThemeContrast(variant, scheme, override);
  const c = shapeContrast(value, dark);
  const surface = parse(p.surface), ink = parse(p.ink);
  const under = hex(mix(surface, dark ? BLACK : ink, dark ? 0.16 + (value - 60) * 0.0015 : 0.04 + (value - 45) * 0.0012));
  const panel = hex(mix(surface, dark ? ink : WHITE, dark ? 0.03 + c * 0.03 : 0.18 + c * 0.008));
  const controls = controlColors(variant, scheme);
  return {
    "--at-bg-app": under,
    "--at-bg-canvas": p.surface,
    "--at-bg-panel": panel,
    // Nested cards stay slightly darker than their panel with a softened separation.
    "--at-bg-elevated": hex(mix(dark ? surface : parse(under), parse(panel), dark ? 0.45 : 0.5)),
    "--at-border-subtle": p.borderSubtle,
    "--at-border-strong": p.borderStrong,
    "--at-text-on-accent": solid(WHITE),
    ...controls,
    "--at-button-primary-bg": primaryButtonBackground(controls["--at-accent-default"]),
    "--at-chart-track": `rgba(${ink.join(", ")}, ${(0.04 + c * 0.02).toFixed(3)})`,
  };
}
