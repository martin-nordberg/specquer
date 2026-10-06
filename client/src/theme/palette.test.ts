import { describe, expect, test } from "bun:test";
import { wcagContrast } from "culori";
import { MIN_CONTRAST, baseColors, derivePalette, fillRoles, paletteStylesheet } from "./palette.ts";

const palette = derivePalette();

describe.each(["light", "dark"] as const)("%s mode", (mode) => {
  const colors = palette[mode];

  test.each([...fillRoles])("text on %s passes WCAG AA", (role) => {
    const { fill, text } = colors.fills[role];
    expect(wcagContrast(fill, text)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  test("text, secondary text and error text on the background pass WCAG AA", () => {
    expect(wcagContrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(wcagContrast(colors.mutedForeground, colors.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(wcagContrast(colors.mutedForeground, colors.muted)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(wcagContrast(colors.errorText, colors.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

test("light mode keeps the given colors where they already pass", () => {
  expect(palette.light.background).toBe(baseColors.background);
  expect(palette.light.foreground).toBe(baseColors.text);
  expect(palette.light.fills.navigation).toEqual({ fill: baseColors.navigation, text: baseColors.background });
});

test("dark text goes on secondary and warning (D14)", () => {
  expect(palette.light.fills.secondary.text).toBe(baseColors.text);
  expect(palette.light.fills.warning.text).toBe(baseColors.text);
  expect(palette.light.fills.secondary.fill).toBe(baseColors.secondary);
});

test("dark mode has a dark background and light text", () => {
  expect(wcagContrast(palette.dark.background, "#000000")).toBeLessThan(2);
  expect(wcagContrast(palette.dark.foreground, "#ffffff")).toBeLessThan(1.3);
});

test("changing a light-mode color still passes", () => {
  const custom = derivePalette({ ...baseColors, primary: "#7fb3e0", error: "#ff6060" });
  for (const mode of [custom.light, custom.dark]) {
    for (const role of fillRoles) expect(wcagContrast(mode.fills[role].fill, mode.fills[role].text)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  }
});

test("stylesheet has both modes", () => {
  const css = paletteStylesheet();
  expect(css).toContain(":root {");
  expect(css).toContain(".dark {");
  expect(css).toContain("--primary-foreground:");
});
