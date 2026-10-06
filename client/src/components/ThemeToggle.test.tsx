import { fireEvent, render, screen } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import { applyTheme, installPalette } from "@/theme/theme";
import { ThemeToggle } from "./ThemeToggle";


test("the toggle offers the other mode", () => {
  const onChange = mock(() => {});
  const { rerender } = render(<ThemeToggle theme="light" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(onChange).toHaveBeenCalledWith("dark");
  rerender(<ThemeToggle theme="dark" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(onChange).toHaveBeenLastCalledWith("light");
});

test("applying a theme sets the dark class on the page", () => {
  applyTheme("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  applyTheme("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("the palette is installed as custom properties for both modes", () => {
  installPalette();
  const css = document.getElementById("specquer-palette")?.textContent ?? "";
  expect(css).toContain("--primary: #2c77b8");
  expect(css).toContain(".dark {");
});
