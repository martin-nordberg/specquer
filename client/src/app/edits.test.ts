import { expect, test } from "bun:test";
import { changesBetween, rebaseEdits } from "./edits";
import { Text } from "@codemirror/state";

test("changesBetween turns one text into the other", () => {
  const a = "# A\n\nsome text\n";
  const b = "# A\n\nsome more text\nand a line\n";
  expect(changesBetween(a, b).apply(Text.of(a.split("\n"))).toString()).toBe(b);
});

test("server edits are applied through changes typed during the save", () => {
  const sent = "# A\n\n## B\n";
  const edits = [
    { from: 0, to: 0, insert: '<a id="RQ-00001"></a>\n\n<a id="RQ-00002"></a>\n' },
    { from: 5, to: 5, insert: '<a id="RQ-00003"></a>\n' },
  ];
  expect(rebaseEdits(sent, sent, edits)).toBe('<a id="RQ-00001"></a>\n\n<a id="RQ-00002"></a>\n# A\n\n<a id="RQ-00003"></a>\n## B\n');
  const typed = "# A typed\n\nnew paragraph\n\n## B more\n";
  expect(rebaseEdits(sent, typed, edits)).toBe(
    '<a id="RQ-00001"></a>\n\n<a id="RQ-00002"></a>\n# A typed\n\nnew paragraph\n\n<a id="RQ-00003"></a>\n## B more\n',
  );
});
