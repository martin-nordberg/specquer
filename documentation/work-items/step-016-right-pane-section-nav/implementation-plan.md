<a id=""></a>

<a id=""></a>
# Step 016 - Implementation Plan

_Plan for the [Outline requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 016 adds the Outline, a third kind of side pane: a tree of the open document's sections (or, in a document that isn't sectioned, its headings) that moves the file pane, follows it as it scrolls, and shows only what the summary slider leaves visible.

Most of it reuses what Steps 004 and 012 built: the side pane and its toggles, moving to a section, the views reporting the section at their top, and the slider's heading outline. Four parts need care:

| Part | Where | Why it matters |
|---|---|---|
| One tree from two models | `shared/src/markdown/outline.ts` | Sections (`analyzeBody`) carry IDs, UIDs and list items; the slider's heading outline (`buildOutline`) carries outline paths and the stops. The tree needs both, joined, so the slider's stops apply to it exactly as they do to the preview (§4.1, D1) |
| Following and moving without section IDs | `Preview.tsx`, `ContentView.tsx`, `MilkdownEditor.tsx` | Today the views report their top section by UID only, and the Text and WYSIWYG views scroll only to a section ID. Headings in a document that isn't sectioned have neither (§4.3, D3) |
| Parsing as the user types | `client/src/app/` | The App already parses the body on the main thread for comment highlights, following and F8 (the code review's P2). A fourth parse per keystroke for the tree would make it worse (§4.4, D2) |
| The slider in two views only | `App.tsx`, the Outline pane | The tree follows the slider in Preview and Split only (requirements R7.4), with the same steps-to-stop rule as the preview (§4.5) |

There are five phases (§5):

1. the shared model: the outline tree, what a slider stop leaves visible, and the UI state;
2. the views: reporting the top of the view by outline path too, scrolling to an outline path in Text and WYSIWYG, and one parse per body;
3. the pane: the toggle, the tree, its keyboard, collapsing, the slider and the link;
4. end-to-end tests;
5. documentation.

Decisions taken while planning are in §6, marked _Proposed_. The work proceeds on them unless they are changed.

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Before | Step 016 (wins) |
|---|---|---|
| `onTopSection` | A field of `CommentMarkers`, reporting a UID, present only while the Comments pane has threads loaded | A prop of `ContentView` of its own, reporting `{ uid, outlinePath }`, present whenever the Comments or Outline pane is open (§4.3) |
| `ScrollTarget` with an `outlinePath` | Handled by the preview only; citations switch Text and WYSIWYG to Preview | Handled by all three views (§4.3) |
| Parsing the body in the App | `analyzeBody` called again by each user (highlights, following, F8) | One shared, memoized analysis per body (§4.4) |

<a id=""></a>
## 3. Starting Point

- **The side pane** (Step 012): `sidePane: "chat" | "comments" | null` in `shared/src/uistate/uistate.ts`, with `chatPaneFraction` and `commentsPaneFraction`; `toggleSidePane` and `setSidePane`. `App.tsx` renders `CommentsToggle` and `ChatToggle` in the header (both styled by `toggleClass` from `ChatToggle`), and gives `PaneLayout` the open pane's fraction and its `rightLabel`.
- **Sections** (`shared/src/markdown/sections.ts`): `analyzeBody(body).sections` holds `FoundSection`s in document order: the root first, then headings (`depth`, `title` as plain text) and sectioned list items (`title`: the first eight words and " …"), each with `id` and `uid` or `null`. `sectionParents` (`shared/src/sections/tree.ts`) gives each one's parent.
- **The heading outline** (`shared/src/markdown/outline.ts`): `buildOutline(body)` nests the heading sections by level, with `levels`; `outlineHeadings` gives each heading's outline path (`0.2.1`) in document order; `summaryStopCount` and `summarizedAt(outline, stop, length)` say which sections a stop summarizes (stop 0 is the whole document, the last stop the full text).
- **The slider** (`Preview.tsx`): `stop = max(0, stopCount − 1 − steps)`, where `steps` is the file's `summaryStop` from the UI state, while summaries are enabled.
- **Following** (Step 012, R7.7): the preview, the text view and the WYSIWYG view each call `comments.onTopSection(uid | null)` as they scroll; `App.followSection` turns it into the Comments pane's group.
- **Moving** (`ScrollTarget`): `{ sectionId, uid? }` is handled by all three views; `{ outlinePath }` only by the preview, through the `data-outline-path` it puts on headings (`OUTLINE_PATH_PROPERTY`).
- **Badges** (`SectionBadge.tsx`): the § image (`faviconSvg`) with its status (from `statusLists`, through `statusesOfBody` in `client/src/app/section-status.ts`) and problem marks, inside a button that opens the badge's menu.
- **Anchoring a file** (Step 015): `App` opens `AnchorDialog` for any `TreeNode` through `setAnchoring`.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Shared: The Outline Tree

In `shared/src/markdown/outline.ts`, beside the heading outline it builds on (D1):

```ts
interface OutlineItem {
  key: string;            // the section's UID; else "path:<outline path>" for a heading; else "at:<offset>"
  kind: "heading" | "item";
  text: string;           // the heading, or "REQ-00042 " + the item's first words
  sectionId: string | null;
  uid: string | null;
  outlinePath: string | null;   // headings only
  from: number;           // the section's start in the body
  children: OutlineItem[];
}

outlineTree(body: string, options: { sectioned: boolean }): OutlineItem[]
visibleAt(items: OutlineItem[], summarized: SummarizedSection[]): { items: OutlineItem[]; summarized: Set<string>; whole: boolean }
```

- **Building:** one `analyzeBody` and one `buildOutline` of the same body (§4.4 shares them). Heading sections and `outlineHeadings` are in the same document order, so the n-th heading section gets the n-th outline path. `sectionParents` nests the items; the root section is left out (requirements R2.3).
- **A document that isn't sectioned:** headings only, no list items, `sectionId` and `uid` `null`, and the key `path:<outline path>` (R4.4).
- **A section not saved yet:** no `sectionId`; its key is its UID if the text already has one, else its outline path, else its offset, which lasts only until the next edit (R4.4).
- **List items:** `text` is the ID, a space and the title's words; the title already ends with " …" when it was cut (R3.4).
- **The slider:** `visibleAt` keeps an item whose outline path a stop summarizes, marks it, and drops its children; stop 0 (`document: true`) gives `whole: true` and no items (R7.1 to R7.3). List items inside a summarized section go with it.
- **Following:** `itemAt(items, position)` gives the item for a reported top position (§4.3): by UID, else by outline path, else the last item starting at or before an offset; a position inside a summarized item gives that item (R7.6).

<a id=""></a>
### 4.2 Shared: UI State

- `sidePane` takes `"outline"`; `outlinePaneFraction`, with the chat pane's limits and default, falls back on its own.
- `fileUiStateSchema` gains `outlineCollapsed: string[]` (optional, dropped when empty), the keys of §4.1.
- `setOutlinePaneFraction`, `setOutlineCollapsed(state, path, key, collapsed)`, and `pruneOutlineCollapsed(state, path, keys)`, which drops keys no longer in the document when it is opened (R11.2). Renames and deletes already carry and drop `files` entries.

<a id=""></a>
### 4.3 The Views: Top Position and Scrolling

- **Reporting the top** (R6): `onTopSection` moves from `CommentMarkers` to a `ContentView` prop of its own, `onTopPosition(position: { uid: string | null; outlinePath: string | null })`, passed whenever the Comments or the Outline pane is open (D3).
  - **Preview:** the last anchor above the top, as today, and the last element with `data-outline-path` above it.
  - **Text view:** the section at the top line, as today, and the outline path of the last heading starting at or before it, from the shared analysis (§4.4).
  - **WYSIWYG:** the section at the top position, as today, and the outline path of the n-th heading node before it, counted as `buildOutline` counts (headings outside lists and block quotes).
  - `App.followSection` (comments) keeps using the UID; the Outline uses both.
- **Scrolling to an outline path** (R5.1): the text view takes the heading's offset from `buildOutline` and scrolls it to the top; the WYSIWYG view finds the n-th heading node. Both are done like their existing scroll to a section ID, once per request.
- **Split** passes the same target to both sides already; the side scrolled last reports last, which is what R6.4 asks.

<a id=""></a>
### 4.4 One Parse per Body

`client/src/app/body-sections.ts`: `bodyAnalysis(body)`, a one-entry memo keyed by the body string, holding `analyzeBody(body)` and `buildOutline(body)` (D2). The comment highlight, `followSection`, F8, the text view's top position and the outline all take it, so a keystroke parses once however many use it. The outline reads it 250 ms after typing stops (R2.5), through a debounced copy of the body.

This also does most of the code review's P2. If R8.2's 2,000 sections take longer than 100 ms on the main thread, the analysis moves into the preview worker (§7, risk 1).

<a id=""></a>
### 4.5 The Pane

- **`client/src/components/outline/`:**
  - **`OutlineToggle.tsx`:** Lucide's `TableOfContents` in the header, left of `CommentsToggle`, styled by `toggleClass`, "Outline" with `aria-pressed`.
  - **`OutlinePane.tsx`:** the pane's heading "Outline", the tree or its message (R2.6, R7.3, R9), and the link "Add section anchors…" (R10).
  - **`OutlineTree.tsx`:** the tree (`role="tree"`, `treeitem`, `group`, named "Outline"), with one roving `tabindex` and the keys of R12. Each row is one line, cut with an ellipsis, its full text in `title` (R3.1). The icon and the indentation expand and collapse; the text and the space right of it move (R4.2, R5.1).
  - **`OutlineIcon.tsx`:** a section's badge image with its status and problem marks, drawn as `SectionBadge` draws them but without its button and menu, or Lucide's `Heading` for a heading without a section (R3.2). `SectionBadge` and it share the marks (D4).
- **What the pane is given** (from `App.tsx`):
  - the debounced body and whether the file is sectioned (`statusLists.sectioned`, already loaded for the badges);
  - the badge statuses (`statusesOfBody`) and problems (`getSections`), as the preview has them;
  - the slider's state when the view is Preview or Split and summaries are enabled: `stop` from `summaryStop`, as the preview computes it (R7.4);
  - the top position (§4.3), the file's collapsed keys, and callbacks to move (`setScrollTarget` with `{ sectionId, uid }` or `{ outlinePath }`), to collapse, and to add anchors (`setAnchoring` with the file's node).
- **The highlight** (R5.2, R6): the item clicked, until the next top position after a scroll (R6.5); else `itemAt` of the top position. An item inside a collapsed one shows on that one, fainter (R4.5). The highlighted row scrolls into view unless the pointer is over the pane or the focus is in it, as `CommentsPane` does (R6.3).
- **Header and layout:** `App.tsx` renders `OutlineToggle` first; `PaneLayout` gets `outlinePaneFraction` and `rightLabel="outline"` when the outline is open.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1: The Shared Model

- §4.1 and §4.2.
- Unit tests: `outlineTree` for ATX and setext headings, skipped levels, sectioned list items nested in headings and in each other, placeholders and sections without anchors, and a document that isn't sectioned; `visibleAt` at every stop of a three-level document, with list items under a summarized section, and stop 0; `itemAt` by UID, by outline path, by offset and inside a summary; the UI state's new fields, their fallbacks and pruning.
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 2: The Views

- §4.3 and §4.4, with the Comments pane moved to `onTopPosition` and `bodyAnalysis` and behaving as before.
- Tests: each view reports `{ uid, outlinePath }` as it scrolls, in a sectioned document and in one that isn't; the text and WYSIWYG views scroll to an outline path; `bodyAnalysis` parses once for repeated calls with the same body; the existing comment following and F8 tests unchanged.
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 3: The Pane

- §4.5.
- Component tests:
  - the three-way toggle and its UI state;
  - items, icons (badge, status, heading icon) and texts on one line, list items with their IDs;
  - expanding and collapsing by the icon, the indentation and the keyboard, kept per file by key;
  - a click setting the scroll target and the highlight, and the highlight then following the top position;
  - the highlight inside a collapsed item;
  - the slider: a stop hiding deeper items, the summarized mark, stop 0's message, and every item in the Text and WYSIWYG views;
  - "(Not Markdown)", no file, a document without headings;
  - the link opening the anchor dialog for the file.
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 4: End-to-End Tests

- `e2e/outline.spec.ts`, in Chrome and WebKit:
  - open the Outline, and see the Comments pane close and the choice kept after a reload;
  - collapse a section, reload, and see it still collapsed;
  - click a section and see the preview scrolled to it, highlighted; scroll the preview and see the highlight follow;
  - the same in the Text view of a document that isn't sectioned, by its headings;
  - move the slider a level and see the deeper items disappear and come back;
  - open a TypeScript file in **All Files** and see "(Not Markdown)";
  - "Add section anchors…" on a file outside a sectioned folder, and its message.
- _Done when_ the suite passes on Chrome and WebKit.

<a id=""></a>
### Phase 5: Documentation

- The specifications in requirements §5; `CLAUDE.md`: the Outline's components, `body-sections.ts`, `onTopPosition`, the outline tree in `shared/markdown`, Step 016 in "Project state".
- An Implementation Status section is added here.
- _Done when_ `bun run typecheck`, `bun test`, `bun run test:e2e` and `docs:build` pass.

<a id=""></a>
## 6. Decisions

_Proposed_. The work proceeds on them unless they are changed:

- **D1. The tree is built on the slider's outline** (§4.1). The slider summarizes by outline path; building the tree from the same `buildOutline` makes R7 a filter on paths, with no second notion of what a level is. The new code lives in `outline.ts`, beside what it extends, rather than in a module with a similar name.
- **D2. One memoized analysis per body, on the main thread** (§4.4). It takes the tree's parse off the keystroke path the App already pays for, and fixes most of P2 on the way. Moving it into the worker is kept for when a measurement asks for it.
- **D3. `onTopPosition` is the views' own prop** (§4.3). Today it hangs off the comment markers, so it only exists while threads are loaded; the Outline needs it whenever its pane is open, and needs outline paths too.
- **D4. The tree draws the badge, not `SectionBadge`** (§4.5). `SectionBadge` is a button with a menu and a tooltip of its own; inside a tree row it would be a second focus stop and a menu the requirements leave out. Sharing the drawing of the marks keeps the two looking the same.
- **D5. Keys are UIDs, then outline paths, then offsets** (§4.1). UIDs survive edits; outline paths survive while headings above don't change, which is all a document without sections offers; offsets only serve until the next edit, for sections just typed.
- **D6. The outline follows the slider through the same stop rule as the preview** (§4.5), computed in the App from the stored steps, so the two can't disagree; the preview keeps rendering its own.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A 2,000-section document parsed on the main thread | Typing lags, or the tree is slow to appear (R8) | One parse per body, read 250 ms after typing stops; measure in Phase 3, and move the analysis into the worker if it is over budget |
| Counting headings in Milkdown as `buildOutline` does | The WYSIWYG view reports or scrolls to the wrong heading in a document that isn't sectioned | Count only top-level heading nodes, as `buildOutline` skips headings in lists and block quotes; tests with headings inside a quote and a list |
| Two scroll reports in Split | The highlight jumps between the sides' different tops | The side scrolled last wins; a programmatic scroll from a click reports both sides at the same section |
| Outline paths shift when a heading is inserted | A collapsed heading in a document that isn't sectioned changes | Accepted in the requirements (R4.4); sectioned documents use UIDs |
| Moving `onTopSection` out of the comment markers | The Comments pane stops following the document | Phase 2 keeps the Comments pane's following tests unchanged and passing |

<a id=""></a>
## 8. Implementation Status

Phases 1 to 5 were carried out in October 2026, one commit each. What differs from the plan, or was learned doing it:

1. **Only top-level list items are sections.** An anchor in a nested list item is a stray, so the requirements' "a sectioned list item holds its sectioned nested items" was wrong; R2.1 now says so, and list items never have children in the tree.
2. **The tree is built in the preview worker** (D2 revised, §7 risk 1 realized). Measured: parsing a 10,000-line, 2,000-section document takes 300 to 600 ms, and `buildOutline` parsed it a second time. `outlineOf` in `outline.ts` does one parse for the tree and the badges' statuses, and runs in the worker through `PreviewRenderer.outline`; `buildOutline` takes the sections when it has them. The main thread's own lookups still go through `bodySections`, one parse per body. R8.2's 100 ms isn't reachable; R8 now records what is.
3. **The Outline follows the preview's own summaries, not the stop** (D6 revised). The preview shows a short section, or one not saved yet, as written even at a stop that summarizes it, so the stop alone would hide items the preview shows. The preview reports the sections it really summarizes (`onSummarized`), only when they change, and nothing when it unmounts, which is how Text and WYSIWYG show every section.
4. **The top position goes through a small store** (`TopPositionStore`), so scrolling re-renders only the Outline, not the workspace. The views also report once when they open or render, so an item is highlighted before the first scroll; above the first heading the first item is.
5. **A click's own scrolling is ignored for 300 ms** (R6.5): reports in that window come from the scroll the click caused, which for the last sections stops above them.
6. **Rows have a chevron** in the indentation for items with items below them, as the folder tree has, besides the icon and the space that also toggle.
7. **The debounce restarts only on a change of document or text** (one string), and another document's tree shows at once, without waiting.
8. **`statusesOfBody` and the text view's section lookup** use `bodySections` too, removing two more parses per keystroke on the main thread.
9. **Tests:** `bun run typecheck` and `bun test` (756) pass. The end-to-end suite passes on Chrome and WebKit (202), including the new `e2e/outline.spec.ts`. Reporting the top while scrolling needs real layout, so it is covered there rather than in component tests.

