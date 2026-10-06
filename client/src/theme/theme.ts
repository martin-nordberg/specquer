import { useEffect, useState } from "react";
import type { Theme } from "@specquer/shared/uistate";
import { paletteStylesheet } from "./palette";

/** Adds the palette's custom properties to the page. */
export function installPalette(doc: Document = document): void {
  const style = doc.createElement("style");
  style.id = "specquer-palette";
  style.textContent = paletteStylesheet();
  doc.head.append(style);
}

const query = "(prefers-color-scheme: dark)";

/** The browser's preferred mode, followed until the user chooses one. */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof matchMedia !== "undefined" && matchMedia(query).matches ? "dark" : "light",
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const media = matchMedia(query);
    const listener = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return theme;
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.classList.toggle("dark", theme === "dark");
}
