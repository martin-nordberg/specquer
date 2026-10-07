import { expect, test } from "bun:test";
import { formatSectionId, isPrefix, isSectionId, parseSectionId } from "./ids.ts";

test("section IDs have a prefix and five or more digits", () => {
  for (const id of ["REQ-00001", "P5VV3-12345", "AB-123456"]) expect(isSectionId(id)).toBe(true);
  for (const id of ["REQ-0001", "Req-00001", "VERYLONG-00001", "S-00001", "1WAY-00001", "REQ00001", "REQ-00001 ", ""]) {
    expect(isSectionId(id)).toBe(false);
  }
});

test("prefixes", () => {
  expect(isPrefix("REQ")).toBe(true);
  expect(isPrefix("P5VV3")).toBe(true);
  for (const prefix of ["Req", "VERYLONG", "S", "1WAY", ""]) expect(isPrefix(prefix)).toBe(false);
});

test("parse and format", () => {
  expect(parseSectionId("REQ-00257")).toEqual({ prefix: "REQ", sequence: 257 });
  expect(parseSectionId("REQ-123456")).toEqual({ prefix: "REQ", sequence: 123456 });
  expect(parseSectionId("nope")).toBeNull();
  expect(formatSectionId("REQ", 7)).toBe("REQ-00007");
  expect(formatSectionId("REQ", 100000)).toBe("REQ-100000");
  expect(() => formatSectionId("req", 1)).toThrow();
});
