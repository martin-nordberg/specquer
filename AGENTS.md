<!-- specquer:section-anchors -->
## Section anchors

Section anchors (`<a id="SPEC-00012" data-uid="k1v2u0xwq8y7"></a>`) give sections of the specs permanent IDs, which links and traceability depend on.

- When moving a section, move its anchor with its heading or list item.
- Never edit, copy or invent an `id` or a `data-uid`; when copying a section, leave its anchor out. The one exception: to give a section another prefix, replace only its `id` with `XYZ-?` (`XYZ` the prefix), keeping its `data-uid`.
- For a new section, write `<a id=""></a>` before its heading (or at the start of its list item) and Specquer assigns the ID, in its parent section's prefix; `<a id="XYZ-?"></a>` asks for prefix `XYZ`.
- Change a section's `data-status` only when asked to, and only to a value allowed for its prefix (`.specquer/shared/<prefix>/prefix.config.yaml`, or else Draft, Approved, In Development, Peer Review, Testing, Complete).
- A document's comment threads are in `<name>.md.comments.yaml` beside it. When moving, renaming or deleting a document, move, rename or delete that file with it; otherwise leave it alone.
<!-- /specquer:section-anchors -->
