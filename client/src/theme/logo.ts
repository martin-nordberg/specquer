import { baseColors, logoColors } from "./palette";

/**
 * Specquer's logo, drawn on a 32×32 grid: the section sign (§), for specifications, and a
 * pencil, for editing them. The favicon is the § on a navigation-colored tile; the app icon is
 * the § on a page with the pencil touching it. The docs site's favicon is the § on a gray tile.
 */

/**
 * One stroke of the §: an S that runs into an ellipse in the middle and follows it most of the
 * way round. The § is this stroke and the same stroke turned 180°, which together draw one
 * clean "o" in the middle.
 */
const SECTION_STROKE =
  "M20.4 7.4C19.6 6 18 5 16 5C13.6 5 11.6 6.3 11.6 8.4C11.6 10.5 13.6 11.5 16 11.8" +
  "A4.6 4.2 0 0 1 20.6 16A4.6 4.2 0 0 1 16 20.2A4.6 4.2 0 0 1 11.68 17.44";

/** The §; with `className` and no `color`, a stylesheet in the SVG sets its color. */
function section(color: string | null, width: number, transform = "", className = ""): string {
  const stroke = color === null ? "" : ` stroke="${color}"`;
  return (
    `<g class="${className}" transform="${transform}" fill="none"${stroke} stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${SECTION_STROKE}"/><path d="${SECTION_STROKE}" transform="rotate(180 16 16)"/></g>`
  );
}

/** A pencil pointing along -x with its tip at the origin. */
function pencil(transform: string): string {
  const c = logoColors;
  return (
    `<g transform="${transform}" stroke-linejoin="round">` +
    `<path d="M0 0L5 -2.5V2.5Z" fill="${c.pencilWood}"/>` +
    `<path d="M0 0L1.9 -0.95V0.95Z" fill="${c.pencilLead}"/>` +
    `<rect x="5" y="-2.5" width="8" height="5" fill="${c.pencilBody}"/>` +
    `<rect x="5" y="-0.6" width="8" height="1.2" fill="${c.pencilShade}"/>` +
    `<rect x="13" y="-2.5" width="1.6" height="5" fill="${c.pencilFerrule}"/>` +
    `<rect x="14.6" y="-2.5" width="1.9" height="5" fill="${c.pencilEraser}"/>` +
    `<path d="M0 0L5 -2.5H16.5V2.5H5Z" fill="none" stroke="${c.pencilOutline}" stroke-width="0.9"/>` +
    `</g>`
  );
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;

/** The favicon: a light § on a navigation-colored tile. */
export const faviconSvg = svg(
  `<rect width="32" height="32" rx="7" fill="${baseColors.navigation}"/>` + section(baseColors.background, 2.8),
);

/**
 * The docs site's favicon (`documentation/public/favicon.svg`): the § on a dark gray tile, or
 * a very light gray tile with a dark § when the browser is in dark mode.
 */
export const docsFaviconSvg = svg(
  `<style>.tile{fill:${logoColors.docsTileLight}}.mark{stroke:${logoColors.docsMarkLight}}` +
    `@media (prefers-color-scheme: dark){.tile{fill:${logoColors.docsTileDark}}.mark{stroke:${logoColors.docsMarkDark}}}</style>` +
    `<rect class="tile" width="32" height="32" rx="7"/>` +
    section(null, 2.8, "", "mark"),
);

/** The app icon: a page with a folded corner, a §, and a pencil touching the §'s lower curve. */
export const appIconSvg = svg(
  `<path d="M6.5 2.5H19.5L25.5 8.5V29.5H6.5Z" fill="${baseColors.background}" stroke="${baseColors.navigation}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M19.5 2.5V8.5H25.5" fill="none" stroke="${baseColors.navigation}" stroke-width="1.6" stroke-linejoin="round"/>` +
    section(baseColors.navigation, 3.6, "translate(5.6 6.2) scale(0.66)") +
    pencil("translate(20.1 21.8) rotate(-45) scale(0.82)"),
);

export function svgDataUri(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

/** Sets the page's favicon (allowed by the Content-Security-Policy's `img-src data:`). */
export function installFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = svgDataUri(faviconSvg);
  document.head.append(link);
}
