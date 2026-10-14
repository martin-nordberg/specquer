import { type Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter } from "@codemirror/view";
import { analyzeBody } from "@specquer/shared/markdown";
import { sectionExtents } from "@specquer/shared/sections";
import { type CommentMarkers, flashClass, pipElement } from "./markers";

/**
 * Comment pips and highlights in the text view (Step 012, decision D3): a gutter marker on each
 * anchor line of a section with threads, and a tint on the lines of highlighted sections. The
 * editor reads its extensions once, so this one is created once and given new markers with an
 * effect; the markers then move with edits until the next ones come. CodeMirror hides its gutters
 * from assistive technology, so there the Comments pane and F8 are the way to the threads.
 */

type Markers = Pick<CommentMarkers, "counts" | "previews" | "filter" | "highlight" | "flash" | "onPip" | "onPipHover">;

class PipMarker extends GutterMarker {
  constructor(
    private readonly markers: Markers,
    private readonly uid: string,
    private readonly count: number,
  ) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof PipMarker && other.uid === this.uid && other.count === this.count && other.markers === this.markers;
  }

  override toDOM(): Node {
    const { markers, uid, count } = this;
    return pipElement({ sectionUid: uid, count, filter: markers.filter, previews: markers.previews.get(uid) ?? [], onPip: markers.onPip, onPipHover: markers.onPipHover });
  }
}

interface GutterState {
  pips: RangeSet<GutterMarker>;
  lines: DecorationSet;
}

export const setCommentMarkersEffect = StateEffect.define<Markers | null>();

function build(text: string, doc: EditorView["state"]["doc"], markers: Markers | null): GutterState {
  if (markers === null) return { pips: RangeSet.empty, lines: Decoration.none };
  const sections = analyzeBody(text).sections;
  const pips = sections.flatMap((section) => {
    const count = section.uid === null ? 0 : (markers.counts.get(section.uid) ?? 0);
    if (count === 0 || section.anchor === undefined) return [];
    return [new PipMarker(markers, section.uid!, count).range(doc.lineAt(section.anchor.from).from)];
  });
  const tinted = new Map<number, string>();
  const tint = (uids: readonly string[] | null | undefined, className: string) => {
    if (uids === null || uids === undefined || uids.length === 0) return;
    const wanted = new Set(uids);
    const extents = sectionExtents(sections.map((section) => ({ ...section, start: section.anchor?.from ?? section.insertAt })), text.length);
    sections.forEach((section, index) => {
      if (section.uid === null || !wanted.has(section.uid)) return;
      const { from, to } = extents[index]!;
      for (let line = doc.lineAt(from).number; line <= doc.lineAt(Math.max(from, to - 1)).number; line++) {
        const start = doc.line(line).from;
        tinted.set(start, `${tinted.get(start) ?? ""} ${className}`.trim());
      }
    });
  };
  tint(markers.highlight, "comment-highlight");
  if (markers.flash !== null) tint(markers.flash.uids, flashClass(markers.flash));
  const lines = [...tinted.entries()].sort((a, b) => a[0] - b[0]).map(([from, className]) => Decoration.line({ class: className }).range(from));
  return { pips: RangeSet.of(pips, true), lines: Decoration.set(lines) };
}

const markersField = StateField.define<GutterState>({
  create: () => ({ pips: RangeSet.empty, lines: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setCommentMarkersEffect)) return build(tr.state.doc.toString(), tr.state.doc, effect.value);
    return tr.docChanged ? { pips: value.pips.map(tr.changes), lines: value.lines.map(tr.changes) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.lines),
});

/** The extension: create it once per editor. */
export function commentGutter(): Extension {
  return [
    markersField,
    gutter({
      class: "cm-comment-gutter",
      markers: (view) => view.state.field(markersField).pips,
    }),
  ];
}

/** Gives the text view new markers. */
export function setCommentGutterMarkers(view: EditorView, markers: Markers | null): void {
  view.dispatch({ effects: setCommentMarkersEffect.of(markers) });
}
