import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { expect, test } from "bun:test";
import { CodeEditor } from "./CodeEditor";

const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;

test("an outside change marked undoable can be undone; other outside changes stay out of the history", () => {
  const props = { onChange: () => {}, language: "markdown" as const, ariaLabel: "Markdown" };
  const { container, rerender } = render(<CodeEditor {...props} value="# A\n" />);
  const view = viewOf(container);
  // Anchors added on save: not undoable
  rerender(<CodeEditor {...props} value={'<a id="R-00001"></a>\n# A\n'} />);
  expect(undo(view)).toBe(false);
  // A status set in the dialog: undoable
  rerender(<CodeEditor {...props} value={'<a id="R-00001" data-status="Draft"></a>\n# A\n'} undoableEdits={1} />);
  expect(view.state.doc.toString()).toBe('<a id="R-00001" data-status="Draft"></a>\n# A\n');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('<a id="R-00001"></a>\n# A\n');
});
