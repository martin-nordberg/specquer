import { Editor, defaultValueCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark, htmlSchema } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Fragment, type Node, Slice } from "@milkdown/kit/prose/model";
import { $view } from "@milkdown/kit/utils";
import { useEffect, useRef } from "react";
import { anchorTagSectionId, isAnchorCloseTag } from "@specquer/shared/markdown";
import { cn } from "@/lib/utils";
import { faviconSvg, svgDataUri } from "@/theme/logo";

const badgeUri = svgDataUri(faviconSvg);

/**
 * Shows section anchors as badges. Milkdown keeps raw HTML as atomic `html` nodes and writes
 * them back unchanged, so the anchors survive editing; this only changes how they look: an
 * anchor's open tag becomes the badge (its section ID in the tooltip) and its closing tag
 * disappears. Other raw HTML still shows as text.
 */
const sectionAnchorView = $view(htmlSchema.node, () => (node, view, getPos) => {
  const value = String(node.attrs.value ?? "");
  const dom = document.createElement("span");
  dom.dataset.type = "html";
  dom.contentEditable = "false";
  const sectionId = anchorTagSectionId(value);
  if (sectionId !== undefined) {
    dom.className = "section-badge";
    dom.dataset.sectionId = sectionId;
    dom.title = sectionId;
    dom.setAttribute("role", "img");
    dom.setAttribute("aria-label", `Section ${sectionId}`);
    const img = document.createElement("img");
    img.src = badgeUri;
    img.alt = "";
    dom.append(img);
  } else {
    const position = getPos();
    const before = position === undefined ? null : view.state.doc.resolve(position).nodeBefore;
    const closesSectionAnchor =
      isAnchorCloseTag(value) && before?.type.name === "html" && anchorTagSectionId(String(before.attrs.value ?? "")) !== undefined;
    if (closesSectionAnchor) dom.hidden = true;
    else dom.textContent = value;
  }
  return { dom, ignoreMutation: () => true };
});

/** The section IDs of the anchors in a document or fragment. */
function sectionIdsIn(node: Node | Fragment): Set<string> {
  const ids = new Set<string>();
  node.descendants((child) => {
    if (child.type.name !== "html") return true;
    const id = anchorTagSectionId(String(child.attrs.value ?? ""));
    if (id !== undefined) ids.add(id);
    return false;
  });
  return ids;
}

/** The fragment with the open tags of anchors whose IDs are taken turned into placeholders. */
function withPlaceholders(fragment: Fragment, taken: ReadonlySet<string>): Fragment {
  const nodes: Node[] = [];
  fragment.forEach((node) => {
    if (node.type.name === "html") {
      const id = anchorTagSectionId(String(node.attrs.value ?? ""));
      nodes.push(id !== undefined && taken.has(id) ? node.type.create({ ...node.attrs, value: '<a id="">' }) : node);
    } else nodes.push(node.isLeaf ? node : node.copy(withPlaceholders(node.content, taken)));
  });
  return Fragment.fromArray(nodes);
}

/**
 * A pasted section anchor whose ID the document already holds is a copy: it becomes a
 * placeholder, and the next save gives it a new ID (decision D4 of Step 003). Copies from other
 * documents are left to the server, which reports them.
 */
export function placeholdersForPastedCopies(slice: Slice, doc: Node): Slice {
  if (sectionIdsIn(slice.content).size === 0) return slice;
  const taken = sectionIdsIn(doc);
  return new Slice(withPlaceholders(slice.content, taken), slice.openStart, slice.openEnd);
}

/**
 * The WYSIWYG view (Milkdown). Milkdown rewrites Markdown it serializes (list markers, tables,
 * reference links), so its output is reported only after the user changes something; opening a
 * file here never changes it (decision D5).
 */
export interface MilkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}

export function MilkdownEditor({ value, onChange, className }: MilkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let editor: Editor | null = null;
    let disposed = false;
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host.current!);
        ctx.set(defaultValueCtx, value);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          attributes: { class: "markdown", "aria-label": "Markdown content (WYSIWYG)", spellcheck: "true" },
          transformPasted: (slice, view) => placeholdersForPastedCopies(slice, view.state.doc),
        }));
        // Closer to the style most specs use
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
          if (markdown !== previous) onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(sectionAnchorView)
      .use(history)
      .use(listener)
      .create()
      .then((created) => {
        if (disposed) void created.destroy();
        else editor = created;
      });
    return () => {
      disposed = true;
      void editor?.destroy();
    };
    // The editor is created once per document revision (the parent remounts it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={cn("milkdown h-full overflow-auto", className)} data-testid="wysiwyg" />;
}
