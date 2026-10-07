import { expect, test } from "bun:test";
import { wcagContrast } from "culori";
import { appIconSvg, docsFaviconSvg, faviconSvg, installFavicon, svgDataUri } from "./logo";
import { MIN_CONTRAST, baseColors, logoColors } from "./palette";

test("the favicon and app icon are SVGs in the palette's navigation color", () => {
  for (const source of [faviconSvg, appIconSvg]) {
    expect(source).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">');
    expect(source).toContain(baseColors.navigation);
  }
});

test("installFavicon adds an SVG icon link", () => {
  installFavicon();
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  expect(link?.getAttribute("href")).toBe(svgDataUri(faviconSvg));
  link?.remove();
});

test("the docs site's favicon is the gray variant, readable in both modes", async () => {
  const file = Bun.file(`${import.meta.dir}/../../../documentation/public/favicon.svg`);
  expect((await file.text()).trim()).toBe(docsFaviconSvg);
  expect(wcagContrast(logoColors.docsTileLight, logoColors.docsMarkLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  expect(wcagContrast(logoColors.docsTileDark, logoColors.docsMarkDark)).toBeGreaterThanOrEqual(MIN_CONTRAST);
});
