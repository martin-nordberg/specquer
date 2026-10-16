import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "bun:test";
import { CodeFileView } from "./CodeFileView";
import { FilePlaceholder, formatSize } from "./FilePlaceholder";
import { ImageView, imageUrl } from "./ImageView";

test("a text file shows as a code block with line numbers, its text as text", async () => {
  render(<CodeFileView path="src/a.ts" text={"const a = 1;\n<b>bold</b>\n"} />);
  const view = screen.getByTestId("code-view");
  await waitFor(() => expect(view.querySelector(".code-gutter")?.textContent).toBe("1\n2"));
  expect(view.querySelector(".code-gutter")!.getAttribute("aria-hidden")).toBe("true");
  expect(view.querySelector(".code-text code")!.textContent).toBe("const a = 1;\n<b>bold</b>");
  expect(view.querySelector("b")).toBeNull();
  expect(view.querySelector(".code-text code")!.className).toBe("hljs language-typescript");
});

test("placeholders say why, with the size", () => {
  const { rerender } = render(<FilePlaceholder reason="binary" size={2048} />);
  expect(screen.getByText("This file type cannot be displayed by Specquer.")).toBeTruthy();
  expect(screen.getByText("2.0 KB")).toBeTruthy();
  rerender(<FilePlaceholder reason="not_utf8" size={1} />);
  expect(screen.getByText("This file isn't UTF-8 text, so Specquer can't display it.")).toBeTruthy();
  rerender(<FilePlaceholder reason="too_large" size={6 * 1024 * 1024} />);
  expect(screen.getByText("This file is too large to display.")).toBeTruthy();
  expect(screen.getByText("6.0 MB")).toBeTruthy();
  expect(formatSize(1)).toBe("1 byte");
  expect(formatSize(900)).toBe("900 bytes");
});

test("an image fits the pane, switches to actual size on a click, and shows its sizes", () => {
  render(<ImageView path="docs/logo.png" size={1536} version="1-1536" />);
  const image = screen.getByRole("img", { name: "logo.png" });
  expect(image.getAttribute("src")).toBe(imageUrl("docs/logo.png", "1-1536"));
  expect(imageUrl("a b/c.png", "v")).toBe("/api/image?path=a%20b%2Fc.png&v=v");
  const toggle = screen.getByRole("button", { name: "Show at actual size" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Fit to the pane" }).getAttribute("aria-pressed")).toBe("true");
  Object.defineProperty(image, "naturalWidth", { value: 64 });
  Object.defineProperty(image, "naturalHeight", { value: 32 });
  fireEvent.load(image);
  expect(screen.getByTestId("image-details").textContent).toBe("64 × 32 pixels · 1.5 KB");
});

test("an image that doesn't decode shows a placeholder", () => {
  render(<ImageView path="broken.png" size={10} version="v" />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("This image can't be displayed.")).toBeTruthy();
});
