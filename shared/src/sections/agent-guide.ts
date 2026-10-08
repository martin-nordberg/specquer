/**
 * The section anchor rules for coding agents. Agents rewrite Markdown freely; these few rules
 * keep them from moving text away from its anchor or inventing IDs. Specquer offers to add the
 * block to `AGENTS.md` (from **Add section anchors**); it sits between marker comments, so it is
 * added only once.
 */

export const AGENT_GUIDE_FILE = "AGENTS.md";

const START = "<!-- specquer:section-anchors -->";
const END = "<!-- /specquer:section-anchors -->";

export const AGENT_GUIDE = [
  "## Section anchors",
  "",
  'Section anchors (`<a id="SPEC-00012" data-uid="k1v2u0xwq8y7"></a>`) give sections of the specs permanent IDs, which links and traceability depend on.',
  "",
  "- When moving a section, move its anchor with its heading or list item.",
  "- Never edit, copy or invent an `id` or a `data-uid`; when copying a section, leave its anchor out.",
  '- For a new section, write `<a id=""></a>` before its heading (or at the start of its list item) and Specquer assigns the ID.',
].join("\n");

/** Whether a file's text already holds the guide. */
export function hasAgentGuide(text: string): boolean {
  return text.includes(START);
}

/** The text with the guide appended, separated by a blank line; unchanged if it has it already. */
export function withAgentGuide(text: string): string {
  if (hasAgentGuide(text)) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const block = `${START}\n${AGENT_GUIDE}\n${END}\n`.replace(/\n/g, eol);
  if (text.trim() === "") return block;
  return `${text.replace(/(\r?\n)*$/, "")}${eol}${eol}${block}`;
}
