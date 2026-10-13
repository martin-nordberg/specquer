import { expect, test } from "bun:test";
import { findSections } from "@specquer/shared/markdown";
import { sectionPrefixes } from "./prefixes.ts";

const KNOWN = new Set(["REQ", "XYZ"]);
const prefixes = (body: string) => sectionPrefixes(findSections(body), "REQ", KNOWN);

test("new sections take their parent section's prefix", () => {
  const body = '# A\n\n<a id="XYZ-00001" data-uid="k1v2u0xwq8y7"></a>\n## B\n\n### C\n\n* <a id=""></a> item\n\n## D\n\n# E\n';
  expect(prefixes(body)).toEqual(["REQ", "REQ", "XYZ", "XYZ", "XYZ", "REQ", "REQ"]);
});

test("the root section takes its own prefix, a requested one, or the folder's", () => {
  expect(prefixes('<a id="XYZ-00004" data-uid="k1v2u0xwq8y7"></a>\n\n# A\n')).toEqual(["XYZ", "XYZ"]);
  expect(prefixes('<a id="NEW-?"></a>\n\n# A\n')).toEqual(["NEW", "NEW"]);
  expect(prefixes("# A\n")).toEqual(["REQ", "REQ"]);
});

test("a requested prefix in one save reaches the new sections under it; an unknown prefix falls to the parent's", () => {
  expect(prefixes('<a id="NEW-?"></a>\n# A\n\n## B\n\n# C\n')).toEqual(["REQ", "NEW", "NEW", "REQ"]);
  expect(prefixes('<a id="ABC-00001"></a>\n# A\n\n## B\n')).toEqual(["REQ", "REQ", "REQ"]);
});
