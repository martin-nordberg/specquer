import { expect, test } from "bun:test";
import { findSections } from "../markdown/sections.ts";
import { DEFAULT_STATUS_VALUES, matchStatus, sectionStatuses } from "./status.ts";

const lists: Record<string, string[]> = { REQ: ["Proposed", "Accepted", "Done"] };
const statuses = (body: string, folderPrefix?: string) =>
  sectionStatuses(findSections(body), { allowed: (prefix) => (prefix === undefined ? undefined : lists[prefix]) ?? DEFAULT_STATUS_VALUES, ...(folderPrefix === undefined ? {} : { folderPrefix }) });
const effective = (body: string, folderPrefix?: string) => statuses(body, folderPrefix).map((s) => s.effective);

test("matchStatus ignores case and surrounding spaces; blank never matches", () => {
  expect(matchStatus(" peer REVIEW ", DEFAULT_STATUS_VALUES)).toBe("Peer Review");
  expect(matchStatus("Revieww", DEFAULT_STATUS_VALUES)).toBeUndefined();
  expect(matchStatus("  ", DEFAULT_STATUS_VALUES)).toBeUndefined();
});

test("a section without a status inherits its parent's; the root takes the prefix's first value", () => {
  const body = [
    '<a id="SPEC-00001"></a>',
    "",
    '<a id="SPEC-00002" data-status="Testing"></a>',
    "# A",
    "",
    '<a id="SPEC-00003"></a>',
    "## B",
    "",
    '* <a id="SPEC-00004" data-status="Complete"></a> item',
    "",
    '<a id="SPEC-00005"></a>',
    "# C",
    "",
  ].join("\n");
  expect(effective(body)).toEqual(["Draft", "Testing", "Testing", "Complete", "Draft"]);
  expect(statuses(body).map((s) => s.inherited)).toEqual(["Draft", "Draft", "Testing", "Testing", "Draft"]);
});

test("inheritance stops where the prefix changes", () => {
  const body = '<a id="SPEC-00001" data-status="Approved"></a>\n\n<a id="REQ-00001"></a>\n# A\n\n<a id="REQ-00002"></a>\n## B\n\n<a id="SPEC-00002"></a>\n# C\n';
  const result = statuses(body);
  expect(result.map((s) => s.prefix)).toEqual(["SPEC", "REQ", "REQ", "SPEC"]);
  expect(result.map((s) => s.effective)).toEqual(["Approved", "Proposed", "Proposed", "Approved"]);
});

test("placeholders take the requested prefix, or the parent's; the root without an ID the folder's", () => {
  const body = '<a id=""></a>\n\n<a id="REQ-?" data-status="done"></a>\n# A\n\n<a id=""></a>\n## B\n';
  const result = statuses(body, "REQ");
  expect(result.map((s) => s.prefix)).toEqual(["REQ", "REQ", "REQ"]);
  expect(result.map((s) => s.effective)).toEqual(["Proposed", "Done", "Done"]);
  expect(statuses("# A\n").map((s) => s.prefix)).toEqual([undefined, undefined]);
  expect(effective("# A\n")).toEqual(["Draft", "Draft"]);
});

test("an invalid status has no effective status, and its subsections inherit past it", () => {
  const body = '<a id="SPEC-00001" data-status="Testing"></a>\n\n<a id="SPEC-00002" data-status="Revieww"></a>\n# A\n\n<a id="SPEC-00003"></a>\n## B\n\n<a id="SPEC-00004" data-status=""></a>\n## C\n';
  const result = statuses(body);
  expect(result.map((s) => s.valid)).toEqual([true, false, true, false]);
  expect(result.map((s) => s.effective)).toEqual(["Testing", null, "Testing", null]);
  expect(result[1]!.own).toBe("Revieww");
});

test("own values are kept as written and matched to the allowed spelling", () => {
  const result = statuses('<a id="SPEC-00001" data-status=" draft "></a>\n\n<a id="SPEC-00002" data-status="Draft"></a>\n# A\n');
  expect(result.map((s) => [s.own, s.canonical, s.inherited, s.effective])).toEqual([
    [" draft ", "Draft", "Draft", "Draft"],
    ["Draft", "Draft", "Draft", "Draft"],
  ]);
});
