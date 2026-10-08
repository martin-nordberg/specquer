import { expect, test } from "bun:test";
import { isShortSection, simplifySectionText, targetSentences, wordCount } from "./rules.ts";

test("simplifySectionText normalizes whitespace and removes section anchors", () => {
  const text = '\r\n<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>\r\n# Title <a id="REQ-00003"></a>  \r\n\r\n\r\n\r\nText\t \r\n<a id=""></a>\n- <a id="REQ-00004" data-uid="cccccccccccc"></a>Item\n\n<a name="r7k2" data-status="draft"></a> <a id="not-a-section"></a>\n\n';
  expect(simplifySectionText(text)).toBe('# Title\n\nText\n\n- Item\n\n<a name="r7k2" data-status="draft"></a> <a id="not-a-section"></a>');
  // Anchor metadata doesn't change the result
  expect(simplifySectionText('<a id="REQ-00002" data-uid="aaaaaaaaaaaa"></a>\n# T\n')).toBe(simplifySectionText('<a id="REQ-00009"></a>\n# T'));
});

test("the length rule", () => {
  expect(wordCount("  one two\nthree  ")).toBe(3);
  expect(isShortSection(Array(59).fill("w").join(" "))).toBe(true);
  expect(isShortSection(Array(60).fill("w").join(" "))).toBe(false);
  expect([60, 224, 225, 450, 1500, 5000].map(targetSentences)).toEqual([2, 2, 2, 3, 10, 10]);
  expect(targetSentences(1049)).toBe(7);
});
