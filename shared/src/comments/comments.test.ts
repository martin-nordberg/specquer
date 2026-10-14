import { describe, expect, test } from "bun:test";
import { checkSidecar, commentChangeSchema, commentVersion, documentOfSidecar, firstLine, isSidecarPath, shownBy, sidecarPath } from "./comments.ts";

const comment = (uid: string, extra: object = {}) => ({ commentUid: uid, createdBy: "Ann", createdAt: "2026-10-10T12:22:59Z", text: "Hi.", ...extra });
const thread = (uid: string, comments: object[], extra: object = {}) => ({ threadUid: uid, sectionUid: "abcdef123456", status: "Open", comments, ...extra });

describe("sidecar paths", () => {
  test("a document's sidecar is its name with .comments.yaml added", () => {
    expect(sidecarPath("docs/a.md")).toBe("docs/a.md.comments.yaml");
    expect(documentOfSidecar("docs/a.md.comments.yaml")).toBe("docs/a.md");
    expect(isSidecarPath("docs/a.md.comments.yaml")).toBe(true);
    expect(isSidecarPath("docs/A.MD.comments.yaml")).toBe(true);
    expect(isSidecarPath("docs/.md.comments.yaml")).toBe(false);
    expect(isSidecarPath("docs/a.txt.comments.yaml")).toBe(false);
    expect(isSidecarPath("docs/a.md")).toBe(false);
  });
});

describe("checkSidecar", () => {
  test("accepts the format, and an empty file", () => {
    const value = {
      threads: [
        thread("q7d2kx9m0w4a", [comment("r3n8vb1z6p0c"), comment("h5t0yq2e7j9s", { updatedBy: "Bo", updatedAt: "2026-10-14T19:05:12Z" })]),
        thread("m1w6fc8u3k5d", [comment("x2g9ra4l7n1e")], { status: "Resolved", statusChangedBy: "Bo", statusChangedAt: "2026-10-13T08:15:40Z" }),
      ],
    };
    const result = checkSidecar(value);
    expect(result.ok).toBe(true);
    expect(checkSidecar(null)).toEqual({ ok: true, threads: [] });
  });

  test("reports what's wrong", () => {
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [comment("r3n8vb1z6p0c")], { status: "Closed" })] })).toMatchObject({ ok: false, problem: "unknown-status" });
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [])] })).toMatchObject({ ok: false, problem: "format" });
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [comment("r3n8vb1z6p0c", { createdAt: "yesterday" })])] })).toMatchObject({ ok: false, problem: "format" });
    expect(checkSidecar({ threads: "none" })).toMatchObject({ ok: false, problem: "format" });
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [comment("q7d2kx9m0w4a")])] })).toMatchObject({ ok: false, problem: "repeated-uid" });
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [comment("r3n8vb1z6p0c", { updatedBy: "Bo" })])] })).toMatchObject({ ok: false, problem: "format" });
    expect(checkSidecar({ threads: [thread("q7d2kx9m0w4a", [comment("r3n8vb1z6p0c")], { statusChangedAt: "2026-10-13T08:15:40Z" })] })).toMatchObject({
      ok: false,
      problem: "format",
    });
  });
});

describe("comments", () => {
  test("a comment's version changes with its text and its update time", () => {
    const original = comment("r3n8vb1z6p0c");
    expect(commentVersion(original)).toBe(commentVersion({ ...original }));
    expect(commentVersion({ ...original, text: "Bye." })).not.toBe(commentVersion(original));
    expect(commentVersion({ ...original, updatedBy: "Bo", updatedAt: "2026-10-14T19:05:12Z" })).not.toBe(commentVersion(original));
  });

  test("firstLine skips blank lines and Markdown's leading marks", () => {
    expect(firstLine("\n\n## A heading\nmore")).toBe("A heading");
    expect(firstLine("- item")).toBe("item");
    expect(firstLine("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });

  test("the filter", () => {
    expect(shownBy("open", "Open")).toBe(true);
    expect(shownBy("open", "Resolved")).toBe(false);
    expect(shownBy("resolved", "Resolved")).toBe(true);
    expect(shownBy("all", "Resolved")).toBe(true);
  });

  test("changes are validated", () => {
    expect(commentChangeSchema.safeParse({ op: "reply", threadUid: "q7d2kx9m0w4a", text: "Yes." }).success).toBe(true);
    expect(commentChangeSchema.safeParse({ op: "reply", threadUid: "Q7", text: "Yes." }).success).toBe(false);
    expect(commentChangeSchema.safeParse({ op: "set-status", threadUid: "q7d2kx9m0w4a", status: "Done" }).success).toBe(false);
  });
});
