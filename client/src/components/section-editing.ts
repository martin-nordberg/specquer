import { type ChangeSpec, EditorState, type Extension, Transaction, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { anchorTagSectionId } from "@specquer/shared/markdown";

/**
 * Editing help for section anchors in the text editor:
 *
 * - **Paste handling.** A pasted section anchor whose ID still exists elsewhere is a copy, so it
 *   becomes a placeholder (`<a id=""></a>`) and the next save gives it a new ID and UID. IDs
 *   in the open document are checked at once; IDs in other documents are looked up after the
 *   paste, and the anchor is replaced when the lookup finds one. A cut followed by a paste keeps
 *   its IDs: the cut removed the original, and opening another file saves this one first.
 * - **Muted UIDs.** `data-uid="…"` is shown in the muted color, so the eye skips it; it stays
 *   visible and editable (no folding).
 */

/** An empty anchor: an open tag (one, the section ID's) and its closing tag. */
const ANCHOR = /<a(?:\s[^<>]*)?>\s*<\/a\s*>/gi;

export const PLACEHOLDER = '<a id=""></a>';

export interface AnchorInText {
  from: number;
  to: number;
  id: string;
}

/** The anchors with section IDs in a text. */
export function sectionAnchorsIn(text: string): AnchorInText[] {
  const found: AnchorInText[] = [];
  for (const match of text.matchAll(ANCHOR)) {
    const id = anchorTagSectionId(match[0].slice(0, match[0].indexOf(">") + 1));
    if (id !== undefined) found.push({ from: match.index, to: match.index + match[0].length, id });
  }
  return found;
}

/** The changes that turn the anchors in a text whose IDs are taken into placeholders. */
export function placeholderChanges(text: string, isTaken: (id: string) => boolean, offset = 0): Array<{ from: number; to: number; insert: string }> {
  return sectionAnchorsIn(text)
    .filter((anchor) => isTaken(anchor.id))
    .map((anchor) => ({ from: offset + anchor.from, to: offset + anchor.to, insert: PLACEHOLDER }));
}

/** Whether a section ID exists in another document. */
export type SectionLookup = (id: string) => Promise<boolean>;

interface Pasted {
  /** IDs pasted that the open document doesn't hold elsewhere: to look up in other documents. */
  ids: string[];
}

/** Turns pasted copies of anchors in this document into placeholders. */
const pasteFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.paste")) return tr;
  const changes: ChangeSpec[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (sectionAnchorsIn(text).length === 0) return;
    const rest = tr.startState.sliceDoc(0, fromA) + tr.startState.sliceDoc(toA);
    const here = new Set(sectionAnchorsIn(rest).map((anchor) => anchor.id));
    changes.push(...placeholderChanges(text, (id) => here.has(id), fromB));
  });
  if (changes.length === 0) return tr;
  return [tr, { changes, sequential: true } satisfies TransactionSpec];
});

/** The anchors left after a paste, looked up in other documents; copies found become placeholders. */
function pasteLookup(lookup: SectionLookup) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    const pasted: Pasted = { ids: [] };
    for (const tr of update.transactions) {
      if (!tr.isUserEvent("input.paste")) continue;
      tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        for (const anchor of sectionAnchorsIn(inserted.toString())) pasted.ids.push(anchor.id);
      });
    }
    if (pasted.ids.length === 0) return;
    const view = update.view;
    for (const id of new Set(pasted.ids)) {
      lookup(id)
        .then((elsewhere) => {
          if (!elsewhere) return;
          // The open document holds this ID only where it was pasted: the filter caught any other copy
          const changes = placeholderChanges(view.state.doc.toString(), (found) => found === id);
          if (changes.length > 0) view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
        })
        .catch(() => undefined);
    }
  });
}

const mutedUid = new MatchDecorator({
  regexp: /data-uid="[^"\n]*"/g,
  decoration: Decoration.mark({ class: "cm-section-uid" }),
});

const mutedUids = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = mutedUid.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = mutedUid.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const mutedTheme = EditorView.theme({ ".cm-section-uid, .cm-section-uid *": { color: "var(--muted-foreground)" } });

/** Paste handling and muted UIDs; `lookup` checks other documents. */
export function sectionEditing(lookup: SectionLookup): Extension {
  return [pasteFilter, pasteLookup(lookup), mutedUids, mutedTheme];
}
