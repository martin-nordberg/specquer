import { expect, test } from "bun:test";
import { extensionOf, fileKind, imageType } from "./kinds.ts";

test("file kinds come from the name alone", () => {
  expect(fileKind("docs/spec.md")).toBe("markdown");
  expect(fileKind("SPEC.MD")).toBe("markdown");
  expect(fileKind("logo.SVG")).toBe("image");
  expect(fileKind("a/photo.jpeg")).toBe("image");
  expect(fileKind("index.ts")).toBe("text");
  expect(fileKind("Makefile")).toBe("text");
  expect(fileKind(".gitignore")).toBe("text");
  expect(fileKind("unknown.xyz")).toBe("text");
  expect(fileKind("manual.PDF")).toBe("binary");
  expect(fileKind("font.woff2")).toBe("binary");
});

test("extensions and image types", () => {
  expect(extensionOf("a/b.Tar.GZ")).toBe(".gz");
  expect(extensionOf(".gitignore")).toBe("");
  expect(extensionOf("LICENSE")).toBe("");
  expect(imageType("x.png")).toBe("image/png");
  expect(imageType("x.JPG")).toBe("image/jpeg");
  expect(imageType("x.svg")).toBe("image/svg+xml");
  expect(imageType("x.txt")).toBeUndefined();
});
