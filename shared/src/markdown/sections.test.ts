import { describe, expect, test } from "bun:test";
import {
  type FoundSection,
  analyzeBody,
  anchorEdits,
  anchorTagSectionId,
  anchorTagStatus,
  applyEdits,
  findSections,
  hasConflictMarkers,
  isAnchorCloseTag,
  rootAnchorText,
  statusEdit,
  withStatus,
} from "./sections.ts";

const DOC = "tz4a98xxat96";
const UID = "k1v2u0xwq8y7";

/**
 * Gives every section without an ID the next of `ids` and every section without a UID the next
 * of u1, u2, … (the root: `documentId`), applies the edits, returns the new body.
 */
function anchor(body: string, ids: string[] = [], documentId = DOC, renumber: Record<number, string> = {}): string {
  const sections = findSections(body);
  const plan = new Map<number, string>(Object.entries(renumber).map(([i, id]) => [Number(i), id]));
  const uids = new Map<number, string>();
  const queue = [...ids];
  let uid = 0;
  sections.forEach((section, index) => {
    if (section.id === null && !plan.has(index)) {
      const id = queue.shift();
      if (id === undefined) throw new Error(`Not enough IDs for ${body}`);
      plan.set(index, id);
    }
    if (index === 0) {
      if (section.uid !== documentId) uids.set(0, documentId);
    } else if (section.uid === null || plan.has(index)) uids.set(index, `u${++uid}`);
  });
  return applyEdits(body, anchorEdits(body, sections, { ids: plan, uids }));
}

const summary = (sections: FoundSection[]) => sections.map((s) => `${s.kind}:${s.id ?? "-"}:${s.title}`);

describe("findSections", () => {
  test("root, ATX heading, setext heading, inline heading form and list items", () => {
    const body = [
      `<a id="REQ-00001" data-uid="${DOC}"></a>`,
      "",
      '<a id="REQ-00002"></a>',
      "# Title",
      "",
      '<a id="REQ-00003"></a> Setext',
      "======",
      "",
      '## <a id="REQ-00004"></a> Inline',
      "",
      '* <a id="REQ-00005"></a> First item',
      "* Second item with quite a few more words than the title keeps",
      '- [ ] <a id="REQ-00006"></a> A task',
      "",
    ].join("\n");
    const sections = findSections(body);
    expect(summary(sections)).toEqual([
      "root:REQ-00001:",
      "heading:REQ-00002:Title",
      "heading:REQ-00003:Setext",
      "heading:REQ-00004:Inline",
      "item:REQ-00005:First item",
      "item:-:Second item with quite a few more words …",
      "item:REQ-00006:A task",
    ]);
    expect(sections[0]!.uid).toBe(DOC);
    expect(sections[1]!.uid).toBeNull();
    expect(sections[1]!.depth).toBe(1);
  });

  test("a blank line between anchor and heading is allowed", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n\n## Title\n`;
    expect(summary(findSections(body))).toEqual(["root:RQ-00001:", "heading:RQ-00002:Title"]);
  });

  test("anchors in code, block quotes and nested lists are ignored", () => {
    const body = [
      "```",
      '<a id="RQ-00001"></a>',
      "# Not a heading",
      "```",
      "",
      '> <a id="RQ-00002"></a>',
      "> # Quoted",
      "",
      "* plain",
      '  * <a id="RQ-00003"></a> nested',
      "",
    ].join("\n");
    expect(summary(findSections(body))).toEqual(["root:-:"]);
  });

  test("lists without anchors aren't sectioned", () => {
    expect(summary(findSections("* a\n* b\n"))).toEqual(["root:-:"]);
  });

  test("blank IDs and XYZ-? are placeholders; other IDs aren't section anchors", () => {
    const body = '<a id=""></a>\n\nText\n\n<a id="NEW-?"></a>\n# Heading\n\n* <a id="x"></a> item\n* <a id=""></a> other\n';
    const sections = findSections(body);
    expect(summary(sections)).toEqual(["root:-:", "heading:-:Heading", "item:-:item", "item:-:other"]);
    expect(sections.map((s) => s.anchor !== undefined)).toEqual([true, true, false, true]);
    expect(sections[1]!.requestedPrefix).toBe("NEW");
    expect(sections[0]!.requestedPrefix).toBeUndefined();
    for (const id of ["intro", "xyz-?", "TODO", "XY-?X", "X-?", "TOOLONG-?"]) {
      expect(findSections(`<a id="${id}"></a>\n\n# H\n`)[1]!.anchor).toBeUndefined();
    }
  });

  test("XYZ-? keeps its UID; a blank placeholder's is ignored", () => {
    const sections = findSections(`# A\n\n<a id="XYZ-?" data-uid="${UID}"></a>\n## B\n\n<a id="" data-uid="${UID}"></a>\n## C\n`);
    expect(sections.map((s) => [s.id, s.uid, s.requestedPrefix ?? null])).toEqual([
      [null, null, null],
      [null, null, null],
      [null, UID, "XYZ"],
      [null, null, null],
    ]);
  });

  test("other anchors before a heading take its section anchor at their paragraph's start", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="intro"></a>\n# A\n\n<a id="x"></a> <a id="y"></a>\n\n## B\n`;
    const sections = findSections(body, { isDocumentUid: (uid) => uid === DOC });
    expect(sections.map((s) => s.form)).toEqual(["root", "paragraph", "paragraph"]);
    const once = applyEdits(body, anchorEdits(body, sections, { ids: new Map([[1, "RQ-00002"], [2, "RQ-00003"]]), uids: new Map([[1, "u1"], [2, "u2"]]) }));
    expect(once).toBe(
      `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a><a id="intro"></a>\n# A\n\n<a id="RQ-00003" data-uid="u2"></a><a id="x"></a> <a id="y"></a>\n\n## B\n`,
    );
    // Read back unchanged
    const again = findSections(once, { isDocumentUid: (uid) => uid === DOC });
    expect(summary(again)).toEqual(["root:RQ-00001:", "heading:RQ-00002:A", "heading:RQ-00003:B"]);
    expect(anchorEdits(once, again, { ids: new Map(), uids: new Map() })).toEqual([]);
  });

  test("other anchors at the start of a heading or a list item get the section anchor before them", () => {
    const body = '## <a id="intro"></a> Title\n\n* <a id="x"></a> one\n* <a id=""></a> two\n';
    const sections = findSections(body);
    expect(sections.map((s) => s.form)).toEqual(["root", "atx", "item", "item"]);
    expect(sections[2]!.anchor).toBeUndefined();
  });

  test("other anchors are left alone", () => {
    const body = '# Alpha <a name="r7k2" data-status="draft"></a>\n\nText <a id="REQ-00001"></a> inline.\n';
    const sections = findSections(body);
    expect(summary(sections)).toEqual(["root:-:", "heading:-:Alpha"]);
    expect(sections[1]!.anchor).toBeUndefined();
  });

  test("a first anchor directly before a heading is the heading's, unless its UID is a document's", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n# Title\n`;
    expect(summary(findSections(body))).toEqual(["root:-:", "heading:RQ-00001:Title"]);
    expect(summary(findSections(body, { isDocumentUid: (uid) => uid === DOC }))).toEqual(["root:RQ-00001:", "heading:-:Title"]);
    // The heading's new anchor goes between the two, with a blank line, restoring the layout
    const restored = applyEdits(body, anchorEdits(body, findSections(body, { isDocumentUid: () => true }), { ids: new Map([[1, "RQ-00002"]]), uids: new Map([[1, "u1"]]) }));
    expect(restored).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
    expect(summary(findSections(restored))).toEqual(["root:RQ-00001:", "heading:RQ-00002:Title"]);
  });

  test("placeholders and invalid UIDs have no UID", () => {
    const sections = findSections('<a id="" data-uid="abcdef"></a>\n\n<a id="RQ-00002" data-uid="Bad-UID"></a>\n## A\n');
    expect(sections.map((s) => s.uid)).toEqual([null, null]);
  });

  test("a first anchor without a blank line before a heading", () => {
    expect(summary(findSections('<a id="RQ-00001"></a>\n# Title\n'))).toEqual(["root:-:", "heading:RQ-00001:Title"]);
    expect(summary(findSections('<a id="RQ-00001"></a>\n\n<a id="RQ-00002"></a>\n# Title\n'))).toEqual([
      "root:RQ-00001:",
      "heading:RQ-00002:Title",
    ]);
    expect(summary(findSections('<a id="RQ-00001"></a>\n\nText\n'))).toEqual(["root:RQ-00001:"]);
  });
});

describe("anchorEdits", () => {
  test("adds every missing anchor", () => {
    const body = "# Title\n\nText\n\n## Sub\nSetext\n---\n\n* <a id=\"\"></a> one\n* two\n";
    const result = anchor(body, ["RQ-00001", "RQ-00002", "RQ-00003", "RQ-00004", "RQ-00005", "RQ-00006"]);
    expect(result).toBe(
      `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n\nText\n\n<a id="RQ-00003" data-uid="u2"></a>\n## Sub\n` +
        '<a id="RQ-00004" data-uid="u3"></a> Setext\n---\n\n* <a id="RQ-00005" data-uid="u4"></a> one\n* <a id="RQ-00006" data-uid="u5"></a> two\n',
    );
    expect(summary(findSections(result))).toEqual([
      "root:RQ-00001:",
      "heading:RQ-00002:Title",
      "heading:RQ-00003:Sub",
      "heading:RQ-00004:Setext",
      "item:RQ-00005:one",
      "item:RQ-00006:two",
    ]);
  });

  test("an empty body gets its root anchor", () => {
    expect(anchor("", ["RQ-00001"])).toBe(rootAnchorText("RQ-00001", DOC));
    expect(findSections(rootAnchorText("RQ-00001", DOC))[0]!.id).toBe("RQ-00001");
  });

  test("a heading right after a paragraph gets a blank line before its anchor", () => {
    const result = anchor("Text\n# Title\n", ["RQ-00001", "RQ-00002"]);
    expect(result).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
  });

  test("anchors go after a byte-order mark", () => {
    const result = anchor("\uFEFF# Title\n", ["RQ-00001", "RQ-00002"]);
    expect(result).toBe(`\uFEFF<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
    expect(findSections(result).map((s) => s.id)).toEqual(["RQ-00001", "RQ-00002"]);
  });

  test("a task item's anchor goes after the box", () => {
    const result = anchor(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n- [ ] <a id="RQ-00002" data-uid="aa"></a> a\n- [x] b\n`, ["RQ-00003"]);
    expect(result).toContain('- [x] <a id="RQ-00003" data-uid="u1"></a> b');
  });

  test("adds a missing UID after the ID and replaces a wrong one", () => {
    expect(anchor('<a id="RQ-00001"></a>\n\nText\n')).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n`);
    expect(anchor('<a class="x" id="RQ-00001" data-uid="old"></a>\n\nText\n')).toBe(`<a class="x" id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n`);
    // A data-document-id is no longer read, and is left as it is
    expect(anchor('<a id="RQ-00001" data-document-id="old"></a>\n\nText\n')).toBe(
      `<a id="RQ-00001" data-uid="${DOC}" data-document-id="old"></a>\n\nText\n`,
    );
  });

  test("renumbering and adding a UID at once", () => {
    expect(anchor(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n# A\n`, [], DOC, { 1: "RQ-00007" })).toBe(
      `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00007" data-uid="u1"></a>\n# A\n`,
    );
  });

  test("renumbers and fills placeholders, keeping other attributes", () => {
    const body = `<a id='RQ-00001' class="x" data-uid="${DOC}"></a>\n\n<a id=RQ-? class="y"></a>\n# A\n`;
    expect(anchor(body, ["RQ-00009"], DOC, { 0: "RQ-00005" })).toBe(
      `<a id="RQ-00005" class="x" data-uid="${DOC}"></a>\n\n<a id="RQ-00009" data-uid="u1" class="y"></a>\n# A\n`,
    );
  });

  test("is stable: a second run makes no edits", () => {
    const bodies = [
      "# A\n\n## B\n\nC\n===\n\n* <a id=\"\"></a> x\n* y\n\n```\n# code\n```\n",
      "Intro\n# A\n> # quoted\n",
      '<a id="RQ-00001"></a>\n# Legacy\n',
      "- [ ] <a id=\"\"></a> task\n- [x] done\n",
    ];
    for (const body of bodies) {
      const ids = Array.from({ length: 20 }, (_, i) => `RQ-${String(i + 100).padStart(5, "0")}`);
      const once = anchor(body, ids);
      const sections = findSections(once);
      expect(sections.every((s) => s.id !== null)).toBe(true);
      expect(sections.every((s) => s.uid !== null)).toBe(true);
      expect(anchorEdits(once, sections, { ids: new Map(), uids: new Map() })).toEqual([]);
    }
  });
});

test("anchorTagSectionId", () => {
  expect(anchorTagSectionId('<a id="REQ-00001">')).toBe("REQ-00001");
  expect(anchorTagSectionId("<a id='REQ-00001' data-uid=\"x\">")).toBe("REQ-00001");
  expect(anchorTagSectionId('<a id="intro">')).toBeUndefined();
  expect(anchorTagSectionId('<a name="REQ-00001">')).toBeUndefined();
  expect(anchorTagSectionId("</a>")).toBeUndefined();
  expect(isAnchorCloseTag("</a>")).toBe(true);
});

describe("stray anchors", () => {
  test("anchors with section IDs outside section places are stray", () => {
    const body = [
      `<a id="RQ-00001" data-uid="${DOC}"></a>`,
      "",
      "Text <a id=\"RQ-00002\"></a> inline.",
      "",
      '<a id="RQ-00003"></a>',
      "# Heading",
      "",
      '> <a id="RQ-00004"></a>',
      "> # quoted",
      "",
      "* plain",
      '  * <a id="RQ-00005"></a> nested',
      "",
      "```",
      '<a id="RQ-00006"></a>',
      "```",
      "",
      '<a id="intro"></a> custom',
      "",
    ].join("\n");
    const { sections, strays } = analyzeBody(body);
    expect(sections.map((s) => s.id)).toEqual(["RQ-00001", "RQ-00003"]);
    expect(strays.map((s) => [s.id, s.line])).toEqual([
      ["RQ-00002", 3],
      ["RQ-00004", 8],
      ["RQ-00005", 12],
    ]);
    expect(body.slice(strays[0]!.from, strays[0]!.to)).toBe('<a id="RQ-00002"></a>');
  });

  test("lines and offsets count a byte-order mark", () => {
    const { strays } = analyzeBody('\uFEFFText\n\nMore <a id="RQ-00002"></a>\n');
    expect(strays.map((s) => s.line)).toEqual([3]);
    expect('\uFEFFText\n\nMore <a id="RQ-00002"></a>\n'.slice(strays[0]!.from, strays[0]!.to)).toBe('<a id="RQ-00002"></a>');
  });
});

test("hasConflictMarkers needs a whole conflict", () => {
  expect(hasConflictMarkers("a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n")).toBe(true);
  expect(hasConflictMarkers("a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> other\r\n")).toBe(true);
  expect(hasConflictMarkers("<<<<<<< HEAD\nx\n||||||| base\nw\n=======\ny\n>>>>>>> other\n")).toBe(true);
  expect(hasConflictMarkers("Title\n=======\n")).toBe(false);
  expect(hasConflictMarkers("<<<<<<< HEAD\nonly one end\n")).toBe(false);
  expect(hasConflictMarkers("<<<<<<< HEAD\nno separator\n>>>>>>> other\n")).toBe(false);
  expect(hasConflictMarkers("text <<<<<<< not at line start\n>>>>>>>> eight\n")).toBe(false);
});

test("hasConflictMarkers ignores a conflict shown in fenced code", () => {
  const example = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch";
  expect(hasConflictMarkers(`# Merging\n\n\`\`\`text\n${example}\n\`\`\`\n`)).toBe(false);
  expect(hasConflictMarkers(`~~~~\n${example}\n~~~~\n`)).toBe(false);
  // A shorter fence or one with an info string doesn't close a longer one
  expect(hasConflictMarkers(`\`\`\`\`\n\`\`\`\n${example}\n\`\`\` x\n\`\`\`\`\n`)).toBe(false);
  // After the code block closes, a conflict counts again
  expect(hasConflictMarkers(`\`\`\`\ncode\n\`\`\`\n${example}\n`)).toBe(true);
});

test("hasConflictMarkers finds a conflict that crosses a fence", () => {
  // The start marker is outside; the two sides open different code blocks
  expect(hasConflictMarkers("<<<<<<< HEAD\n\`\`\`js\n=======\n\`\`\`ts\n>>>>>>> other\ncode\n\`\`\`\n")).toBe(true);
  // The start marker is inside a code block one side closes; the separator is outside
  expect(hasConflictMarkers("\`\`\`\ncode\n<<<<<<< HEAD\n\`\`\`\n## A\n=======\nmore\n\`\`\`\n## B\n>>>>>>> other\n")).toBe(true);
});

describe("statuses in anchors", () => {
  const U2 = "k1v2u0xwq8y8";

  test("data-status is read in every anchor position, in any quoting, with the anchor's line", () => {
    const body = [
      `<a id="RQ-00001" data-uid="${DOC}" data-status="Draft"></a>`,
      "",
      `<a id="RQ-00002" data-uid="${UID}" data-status='Peer Review'></a>`,
      "# Title",
      "",
      `<a id="RQ-00003" data-status=Testing></a> Setext`,
      "======",
      "",
      `* <a data-status=" approved " id="RQ-00004"></a> item`,
      "",
      `<a id="intro"></a><a id="RQ-00005" data-status=""></a>`,
      "## Paragraph form",
      "",
      `## <a id="RQ-00006"></a> No status`,
      "",
    ].join("\n");
    const sections = findSections(body);
    expect(sections.map((s) => s.anchor?.status)).toEqual(["Draft", "Peer Review", "Testing", " approved ", "", undefined]);
    expect(sections.map((s) => s.anchor?.line)).toEqual([1, 3, 6, 9, 11, 14]);
  });

  test("lines count a byte-order mark", () => {
    const sections = findSections(`\uFEFF<a id="RQ-00001" data-uid="${DOC}" data-status="Draft"></a>\n\n# A\n`);
    expect(sections[0]!.anchor!.line).toBe(1);
    expect(sections[0]!.anchor!.statusAttribute!.from).toBe(`\uFEFF<a id="RQ-00001" data-uid="${DOC}" `.length);
  });

  test("anchorEdits keeps data-status when it changes IDs and UIDs", () => {
    const body = `<a id="RQ-00001" data-status="Draft"></a>\n\n<a id="XY-?" data-uid="${UID}" data-status="Testing"></a>\n# A\n`;
    expect(anchor(body, [], DOC, { 1: "XY-00001" })).toBe(
      `<a id="RQ-00001" data-uid="${DOC}" data-status="Draft"></a>\n\n<a id="XY-00001" data-uid="u1" data-status="Testing"></a>\n# A\n`,
    );
  });

  test("anchorEdits corrects a status's spelling, replacing only its value", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}" data-status=' peer review '></a>\n\nText\n`;
    const sections = findSections(body);
    const edits = anchorEdits(body, sections, { ids: new Map(), uids: new Map(), statuses: new Map([[0, "Peer Review"]]) });
    expect(applyEdits(body, edits)).toBe(`<a id="RQ-00001" data-uid="${DOC}" data-status="Peer Review"></a>\n\nText\n`);
    // A status already written that way needs no edit
    const fixed = applyEdits(body, edits);
    expect(anchorEdits(fixed, findSections(fixed), { ids: new Map(), uids: new Map(), statuses: new Map([[0, "Peer Review"]]) })).toEqual([]);
  });

  test("statusEdit adds after data-uid (or id), changes and removes the attribute", () => {
    const set = (body: string, index: number, status: string | null) => {
      const edit = statusEdit(body, findSections(body)[index]!, status);
      return edit === undefined ? body : applyEdits(body, [edit]);
    };
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a class="x" id="RQ-00002" data-uid="${U2}" title="t"></a>\n# A\n\n<a id="RQ-00003"></a>\n## B\n`;
    const added = set(body, 1, "Approved");
    expect(added).toContain(`<a class="x" id="RQ-00002" data-uid="${U2}" data-status="Approved" title="t"></a>`);
    expect(set(body, 2, "Testing")).toContain('<a id="RQ-00003" data-status="Testing"></a>');
    const changed = set(added, 1, "Complete");
    expect(changed).toContain(`data-uid="${U2}" data-status="Complete" title="t"`);
    expect(set(changed, 1, null)).toBe(body);
    expect(statusEdit(added, findSections(added)[1]!, "Approved")).toBeUndefined();
    expect(statusEdit(body, findSections(body)[1]!, null)).toBeUndefined();
    // Recognized again with the same ID and UID
    expect(findSections(added).map((s) => [s.id, s.uid])).toEqual(findSections(body).map((s) => [s.id, s.uid]));
  });

  test("withStatus and anchorTagStatus work on an open tag", () => {
    expect(withStatus(`<a id="RQ-00002" data-uid="${U2}">`, "Draft")).toBe(`<a id="RQ-00002" data-uid="${U2}" data-status="Draft">`);
    expect(withStatus(`<a id="RQ-00002" data-status="Draft" data-uid="${U2}">`, null)).toBe(`<a id="RQ-00002" data-uid="${U2}">`);
    expect(withStatus(`<a id="RQ-00002" data-status="Draft">`, "Testing")).toBe(`<a id="RQ-00002" data-status="Testing">`);
    expect(withStatus("<b>", "Draft")).toBe("<b>");
    expect(anchorTagStatus(`<a id="RQ-00002" data-status='Peer Review'>`)).toBe("Peer Review");
    expect(anchorTagStatus(`<a id="RQ-00002">`)).toBeUndefined();
  });
});
