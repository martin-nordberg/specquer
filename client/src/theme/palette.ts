import { type Oklch, clampChroma, formatHex, interpolate, oklch, wcagContrast } from "culori";

/**
 * Specquer's colors. This is the one place they are defined: only the light-mode colors are
 * given; dark mode and the text color on each fill are derived (implementation plan §4.6).
 */
export const baseColors = {
  /** Main document text */
  text: "#081f37",
  /** Document background */
  background: "#fafafa",
  /** Secondary buttons and similar fills */
  secondary: "#5fc9f3",
  /** Primary buttons and similar fills */
  primary: "#2e79ba",
  /** Navigation and menus */
  navigation: "#1e549f",
  error: "#cf4647",
  warning: "#f5d061",
};

export type BaseColors = typeof baseColors;

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

export const fillRoles = ["primary", "secondary", "navigation", "error", "warning"] as const;
export type FillRole = (typeof fillRoles)[number];

export interface ModeColors {
  background: string;
  foreground: string;
  /** Subtle fills (hover, code blocks). */
  muted: string;
  /** Secondary text on the background. */
  mutedForeground: string;
  border: string;
  /** The error color, adjusted to be readable as text on the background. */
  errorText: string;
  /** Each fill with the text color chosen for it. */
  fills: Record<FillRole, { fill: string; text: string }>;
}

export interface Palette {
  light: ModeColors;
  dark: ModeColors;
}

function toOklch(color: string): Oklch {
  const result = oklch(color);
  if (result === undefined) throw new Error(`Invalid color '${color}'`);
  return result;
}

function hex(color: Oklch): string {
  return formatHex(clampChroma(color, "oklch"));
}

function withLightness(color: string, l: number, chromaScale = 1): string {
  const c = toOklch(color);
  return hex({ ...c, l, c: c.c * chromaScale });
}

function mix(a: string, b: string, amount: number): string {
  return hex(interpolate([a, b], "oklch")(amount) as Oklch);
}

/**
 * Moves a color's lightness in small steps, keeping hue and chroma, until it contrasts enough
 * with `other`. Moves away from `other`'s lightness.
 */
export function nudgeForContrast(color: string, other: string, min = MIN_CONTRAST): string {
  const start = toOklch(color);
  const direction = start.l > toOklch(other).l ? 1 : -1;
  let current = color;
  for (let l = start.l; l >= 0 && l <= 1 && wcagContrast(current, other) < min; l += direction * 0.005) {
    current = hex({ ...start, l });
  }
  return current;
}

/**
 * Picks the text color for a fill (whichever of the mode's light and dark text contrasts more),
 * then nudges the fill if the pair is still under the minimum.
 */
export function fillWithText(fill: string, lightText: string, darkText: string): { fill: string; text: string } {
  const text = wcagContrast(fill, lightText) >= wcagContrast(fill, darkText) ? lightText : darkText;
  return { fill: nudgeForContrast(fill, text), text };
}

function modeColors(
  base: BaseColors,
  background: string,
  foreground: string,
  fillOverrides: Partial<Record<FillRole, string>> = {},
): ModeColors {
  const [lightText, darkText] = toOklch(background).l > toOklch(foreground).l ? [background, foreground] : [foreground, background];
  const fills = Object.fromEntries(
    fillRoles.map((role) => [role, fillWithText(fillOverrides[role] ?? base[role], lightText, darkText)]),
  ) as ModeColors["fills"];
  return {
    background,
    foreground,
    muted: mix(background, foreground, 0.06),
    mutedForeground: nudgeForContrast(mix(background, foreground, 0.6), mix(background, foreground, 0.06)),
    border: mix(background, foreground, 0.18),
    errorText: nudgeForContrast(base.error, background),
    fills,
  };
}

/** Derives both modes from the light-mode colors. */
export function derivePalette(base: BaseColors = baseColors): Palette {
  // Dark mode: a very dark background with the text color's hue, near-white text with the same
  // hue, and a darker navigation color so it reads as a surface
  const darkBackground = withLightness(base.text, 0.17, 0.6);
  const darkForeground = withLightness(base.text, 0.95, 0.15);
  return {
    light: modeColors(base, base.background, base.text),
    dark: modeColors(base, darkBackground, darkForeground, { navigation: withLightness(base.navigation, 0.3) }),
  };
}

/** CSS custom properties for one mode, read by Tailwind, shadcn components and the editors. */
export function cssVariables(colors: ModeColors): Record<string, string> {
  const vars: Record<string, string> = {
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--muted": colors.muted,
    "--muted-foreground": colors.mutedForeground,
    "--border": colors.border,
    "--input": colors.border,
    "--ring": colors.fills.primary.fill,
    "--card": colors.background,
    "--card-foreground": colors.foreground,
    "--popover": colors.background,
    "--popover-foreground": colors.foreground,
    "--accent": colors.muted,
    "--accent-foreground": colors.foreground,
    "--error-text": colors.errorText,
    "--destructive": colors.fills.error.fill,
    "--destructive-foreground": colors.fills.error.text,
  };
  for (const role of fillRoles) {
    vars[`--${role}`] = colors.fills[role].fill;
    vars[`--${role}-foreground`] = colors.fills[role].text;
  }
  return vars;
}

/** A stylesheet with both modes: light on `:root`, dark on `.dark`. */
export function paletteStylesheet(palette: Palette = derivePalette()): string {
  const block = (selector: string, colors: ModeColors) =>
    `${selector} {\n${Object.entries(cssVariables(colors))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n")}\n}`;
  return `${block(":root", palette.light)}\n${block(".dark", palette.dark)}\n.dark { color-scheme: dark; }\n`;
}
