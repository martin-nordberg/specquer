# Requirements Traceability Links Between Markdown Sections <a name="obj001" status="draft"></a>

_Notes from October 2026._

**Goal:** links between sections of spec documents that are mostly **visible to users**, pointing at **link targets users don't see**. This note lays out the design as independent decisions that can be debated one at a time, then proposes a combination. It expands on open question 4 of the [Ideas](/specifications/functionality/ideas) specification.

Rendering behavior was checked against GitHub's documented rules, since GitHub is where people will most often read these files without Specquer.

## The Choices <a name="obj002"></a>

1. **How a target is marked:** how a section gets an invisible ID.
2. **How a link is written:** visible in the source and in rendered output.
3. **What IDs look like.**
4. **What extra information links carry:** link type, review state, back-links.
5. **Whether IDs can be made visible:** to whom, and controlled by whom.
6. **What attributes targets carry:** status, creation details and similar metadata.
7. **Where attributes live:** inline in the Markdown, or in files under `.specquer`.

### 1. Marking the Target (Invisible) <a name="obj003"></a>

| Option | Example (in the heading line) | GitHub | Other renderers | Works as a real `#` anchor |
|---|---|---|---|---|
| **A. Empty HTML anchor** | `## Password rules <a name="r7k2"></a>` | Invisible; GitHub documents this as its way to make custom anchors | Invisible in VitePress. react-markdown leaves out raw HTML by default, but Specquer controls its own renderer | **Yes, everywhere** |
| B. HTML comment | `## Password rules <!-- id: r7k2 -->` | Invisible (documented) | Invisible | No: only Specquer understands it |
| C. Heading attribute | `## Password rules {#r7k2}` | **Visible as literal text** | Works in VitePress and Pandoc | Only in tools that support it |
| D. Hidden link-definition trick | `[//]: # (id: r7k2)` on the line after | Invisible | Invisible in any CommonMark renderer | No |
| E. No marker: use the heading slug | `#password-rules` | Nothing to hide | Works | Yes, but **breaks when the heading is reworded** |

- **Put the marker on the heading line itself.** A marker on the line before the heading would, by the specification's own section definition, belong to the *previous* section, and would get separated when sections are cut and pasted.
- **Option A is the only one that is both invisible and a real anchor everywhere.** Option E needs no markup at all, but only works if Specquer keeps links up to date (see "Rewording" below).

### 2. Writing the Link (Visible) <a name="obj004"></a>

| Option | Example | Readable without Specquer | Survives file moves | Survives heading rewording |
|---|---|---|---|---|
| **a. Relative link with an ID anchor** | `[Password rules](../system/auth.md#r7k2)` | Yes: clickable on GitHub and VitePress | No: the path has to be rewritten | **Yes** |
| **b. Reference-style link** | `[Password rules][r7k2]` with `[r7k2]: ../system/auth.md#r7k2` at the end of the file | Yes, renders as a normal link | Only the definitions at the end of the file need rewriting | Yes |
| c. Custom scheme | `[Password rules](spec:r7k2)` | Text shows; the link doesn't work, and GitHub may remove it | **Yes** | Yes |
| d. Wiki-link | `[[r7k2\|Password rules]]` | No: the brackets show as literal text | Yes | Yes |
| e. Links kept outside the Markdown | in `.specquer/links.yaml` | Not visible at all | Yes | Yes |

- **Options a and b keep links visible everywhere and degrade gracefully;** they need Specquer to rewrite paths when files move.
- **Options c and d are robust without that help,** but only work in Specquer.
- **Option e breaks the "user-visible links" requirement.**
- **Option b deserves a closer look.** The paths live in one block of definitions per file, so a file move means Specquer rewrites a few lines at the end, not links scattered through the prose. The body text stays clean, like `see [Password rules][r7k2]`.

### 3. What IDs Look Like <a name="obj005"></a>

| Style | Example | Pros | Cons |
|---|---|---|---|
| Sequential, meaningful | `REQ-12` | Easy to cite in conversation, tickets and commits | **Collides across branches:** two branches both add `REQ-13`. Also implies an order that edits break |
| Hierarchical, meaningful | `AUTH-PWD-3` | Readable, grouped | Becomes wrong when sections move or are renamed |
| **Short random** | `r7k2`, `k3x9q` (4 to 6 base-32 characters) | No collisions across branches; easy for Specquer and agents to generate; citable | Not meaningful on its own |
| Slug frozen when created | `password-rules` | Readable | Becomes misleading after the heading is reworded |

- **Short random IDs fit Specquer best.** Parallel work items and coding agents creating sections make collisions a real risk.
- **Since the targets are invisible, Specquer can show each ID as a small badge with "copy link"** in its own UI. People can still cite `r7k2` in commits or tickets without the ID cluttering the Markdown.

### 4. What Links Carry <a name="obj006"></a>

- **A link type.** Traceability links usually have a type: *refines*, *implements*, *verifies*, *derives from*, *conflicts with*. In standard Markdown the cleanest place for it is the link's **title attribute**, which renders as a tooltip:

  ```md
  [Password rules](../system/auth.md#r7k2 "refines")
  ```

  The alternative is a visible lead-in convention, such as `**Refines:** [Password rules](…)`. That is more visible and easier for people to edit, but more rigid.

- **Back-links are computed, not written.** Each link is written once, at its source. Specquer's database computes the reverse direction ("Referenced by: …") and shows it as a panel. Keeping both directions in sync by hand always goes wrong.

- **Suspect links.** This is a classic idea from requirements tools such as DOORS, and fits the fragment database well. When someone confirms a link, Specquer records the target's **content hash at that moment**. If the target section changes later, the link is flagged **suspect** until someone looks at it again. The record lives in the database, so it is invisible. This is likely the most useful traceability feature beyond plain navigation.

  OpenFastTrace does a lighter version in the Markdown itself: its IDs include a revision number (`req~name~1`), and links to an older revision are reported as outdated.

### 5. Making IDs Optionally Visible <a name="obj013"></a>

"Optionally visible" can mean two different things, and they need different mechanisms:

- **A reader's display choice:** the Markdown is identical either way, and each reader chooses whether to see IDs.
- **An author's choice:** the Markdown itself makes an ID visible, including in renderers Specquer doesn't control, such as GitHub.

#### Visibility as a Display Choice (No Change to the Markdown)

- **In Specquer:** the renderer reads the marker and shows the ID however the reader prefers: hidden, a small badge beside the heading, or a badge only on hover. The badge offers "copy link" and "copy ID". The preference lives in `.specquer/uistate.yaml`, like the other UI state.
- **On the VitePress site:** one rule in the site's stylesheet can show every ID without touching the Markdown, for example `h2 a[name]::after { content: attr(name); }`, styled as a small label. The site could offer it as a toggle.
- **On GitHub:** not possible. GitHub doesn't apply custom CSS, so an empty anchor always stays invisible there.

This is the cleanest form of optional visibility, because nobody's choice changes the files or creates Git diffs.

#### Visibility as an Author's Choice (in the Markdown)

| Technique | Example | Visible on GitHub | Drawbacks |
|---|---|---|---|
| Text inside the anchor | `## Password rules <a name="r7k2">r7k2</a>` | Yes | **Changes the heading's slug**: VitePress (checked) and GitHub include the anchor's text, so `#password-rules` becomes `#password-rules-r7k2`, and existing slug links break |
| Text inside the anchor, styled | `<a name="r7k2"><sup>r7k2</sup></a>` or `<kbd>r7k2</kbd>` | Yes; `<sup>` and `<kbd>` are allowed in GitHub Markdown | Same slug change; still adds clutter to the source |
| ID in the heading text | `## REQ-12 Password rules <a name="r7k2"></a>` | Yes | The visible ID is just text: it can be edited or renumbered without Specquer noticing |
| A display-label attribute | `<a name="r7k2" data-label="REQ-12"></a>` | No | Visible only where Specquer or site CSS reads it |

- **Both the "text inside the anchor" techniques change the slug.** That matters only for links that use slugs; links that use the ID are unaffected. It is still a reason to prefer the empty anchor plus display-time visibility.
- **Separating a stable key from a display label settles much of the "REQ-12" debate.** The random `name` is the key that links use and that never changes. An optional `data-label` holds a human-friendly ID, such as `REQ-12` or `AUTH-PWD-3`, which Specquer shows in badges and reports and which can be renumbered or regrouped without breaking any link. Labels are optional and only need to be unique where a team wants them to be.

### 6. Attributes on Targets <a name="obj014"></a>

Once a target has a marker, the marker is a natural place for metadata about the section:

```md
## Password rules <a name="r7k2" data-status="draft" data-created-at="2026-10-06T12:00-04:00" data-created-by="MN"></a>
```

#### Syntax

- **Use `data-` names.** Attributes such as `status` or `created-at` are not valid HTML on an `<a>` element, and could clash with real attributes added later. `data-status`, `data-created-at` and so on are valid, and are kept by VitePress (checked) and by Specquer's own renderer.
- **On GitHub they are invisible and unusable.** GitHub's sanitizer keeps only a fixed list of attributes, so `data-*` attributes don't reach the page. The Markdown file keeps them, which is all Specquer needs.
- **Pick one naming style.** Hyphens (`data-created-at`, `data-created-by`) are the HTML convention; mixing them with underscores (`created_by`) invites mistakes. Specquer can check attribute names against a list in its configuration.
- **Include a time zone in timestamps.** `2026-10-06T12:00` is ambiguous across a distributed team. Use an offset or UTC: `2026-10-06T12:00-04:00` or `2026-10-06T16:00Z`.

#### Which Attributes Belong in the Markdown

| Attribute | Fit | Reasoning |
|---|---|---|
| `data-status` (draft, proposed, approved, deprecated, …) | **Good** | An author's decision that cannot be derived from anything else. Changes show up in Git diffs, which gives an audit trail for free. Needs a fixed list of values |
| `data-label` (human-friendly ID) | **Good** | See decision 5 |
| `data-owner`, `data-priority`, `data-kind` (requirement, constraint, note, …) | Good, if needed | Same reasoning as status: authored decisions |
| `data-created-at`, `data-created-by` | **Debatable** | Git already records who added the marker and when (blame on the marker line). Explicit attributes duplicate that, and can drift from it. They help where Git's history is unreliable: squashed or rebased commits, autosaved edits committed later, or an agent committing on a person's behalf. If kept, they should be written once, when Specquer creates the target, and never changed |
| Last-modified time, revision count | **Poor** | Changes on every edit, creating noisy diffs and merge conflicts. Derive it from Git or the database instead |
| Link review state (for suspect links) | **Poor** | It belongs to a link, not to a target, and changes often. Keep it in the database |

A useful rule: **put in the Markdown what people decide; derive from Git or the database what tools can work out.**

#### Behaviors Specquer Would Add

- **Inheritance.** A `data-status` on a document's top heading (as on this note's title) could apply to every section below it unless a section sets its own. The rule needs to be explicit, and the UI should show whether a value is set or inherited.
- **Editing through the UI.** Status chips and pickers in Specquer's interface, rather than hand-editing HTML, keep values valid. Coding agents would follow the same written conventions as for IDs.
- **Filters and reports.** For example: show only draft sections, list approved requirements that have suspect links, or show sections by owner.
- **Display.** The status can change how a section looks, such as a "Draft" badge or a muted style, in the same way IDs are shown on request.

#### Risks

- **Long heading lines.** Several attributes make headings hard to read in the plain text view. Specquer's CodeMirror view could fold the marker to a small placeholder; other editors will show it in full.
- **WYSIWYG editing.** Milkdown has to preserve unknown inline HTML in headings exactly (see open question 11 of the Ideas specification). If it drops or rewrites the marker, IDs and attributes are lost silently.
- **Moving attributes out later.** If the attributes become too heavy, they can move out of the Markdown into files keyed by ID, leaving only `<a name>` in the Markdown. Keeping the key separate from the attributes keeps that option open. Decision 7 compares the two placements.

### 7. Where Attributes Live: Inline or in `.specquer` <a name="obj015"></a>

Attributes can be stored **inline**, as `data-*` attributes on the marker, or **externally**, in files under `.specquer` keyed by the target ID. Only the ID has to stay in the Markdown either way.

#### External Storage Must Be Committed Text

Status and similar attributes are shared decisions, so they must travel with the repository. That rules out two external places:

- **The SQLite cache** (see the [database note](/notes/database-choice)): binary and rebuildable, so it is never committed and can't be the only home of anything authored.
- **Git notes:** they attach to commits, not to sections, and most tools and hosting services don't show or transfer them by default.

That leaves committed text files, which forces a decision on open question 7 of the Ideas specification: `.specquer` would need a committed part (for example `.specquer/shared/`) separate from per-user state (`uistate.yaml`) and the cache (`cache.db`), which stay ignored by Git.

There are three ways to lay out those files:

| Layout | Example | Merge conflicts | Survives file moves and renames | Orphaned records |
|---|---|---|---|---|
| One central file | `.specquer/shared/targets.yaml` | **Frequent:** Git conflicts when two branches change nearby lines, even for different targets | Yes: keyed by ID | Easy to find and clean up |
| One file per document | `.specquer/shared/targets/system/auth.yaml` | Only when the same document changes on both branches | **No:** the file must move with its document, which Specquer only does for moves it sees | Per document |
| **One file per target** | `.specquer/shared/targets/r7k2.yaml` | **Only when the same target changes on both branches**, which is a real conflict | Yes | One file per orphan |

If attributes are stored externally, **one file per target** is the best layout. The number of files is large but harmless, and the files never need to move.

#### Inline vs External, Criterion by Criterion

| Criterion | Inline (`data-*` on the marker) | External (`.specquer/shared/targets/<id>.yaml`) |
|---|---|---|
| Readability of the Markdown | Worse: long heading lines | **Better:** only `<a name="r7k2"></a>` remains |
| Reviewing a change in a pull request | **Better:** a status change appears next to the section it applies to | Worse: it appears in a separate file, showing only an ID |
| Kept with the content in Git | **Automatic:** the same file, the same commit, every branch and every past version | Only if both files are committed together; committing the Markdown but not the `.specquer` file makes them drift apart |
| Merging branches | Good: changes to different sections are on different lines | Good with one file per target |
| Cut and paste between documents | **Automatic:** attributes move with the section | Automatic too: the record is keyed by ID, so moves don't matter |
| Copying a section | Copies the attributes along with the ID; Specquer must give the copy a new ID and decide which attributes it keeps (probably resetting status to draft) | **Cleaner:** the copy gets a new ID with no record, so it starts with defaults |
| Deleting a section | **Clean:** the attributes go with it | Leaves an orphaned record. Cleaning it up is risky: the target may only have moved in an uncommitted edit, or may still exist on another branch |
| Coding agents | **Agents see and can set attributes** while editing the Markdown, but can also damage or drop them | Agents ignore attributes unless told about the files or given a Specquer interface (HTTP API, CLI or MCP server). Agents can't drop attributes they never touch |
| Editors other than Specquer (CodeMirror, Milkdown, VS Code, GitHub's editor) | Every editor must preserve the inline HTML. Milkdown is a known risk (open question 11) | **No risk:** editors never see the attributes |
| Searching without Specquer | **Better:** `grep 'data-status="draft"'` finds the file and the heading in one step | Worse: grep finds IDs, which then have to be looked up in the Markdown |
| Large or structured data (review history, approvals, comments, rationale) | **Poor:** heading lines can't hold it | **Good:** YAML handles lists, nested records and long text |
| Querying inside Specquer | Same either way: Specquer indexes both into its SQLite cache | Same |

#### The Deciding Question: Who Writes It, and How Often?

The criteria sort attributes by who writes them, how often they change, and how large they are:

| Kind of data | Examples | Where |
|---|---|---|
| **Small decisions made by people, changing rarely** | status, label, owner, priority, kind | **Inline.** Reviewing them in context and having them versioned with the content outweigh the longer headings |
| **Records written by tools, never edited by hand** | created-at, created-by, approval records, review history, rationale, comments | **External,** one file per target. They grow over time, are structured, and should stay out of the way of editors |
| **Anything that can be derived** | last modified, revision counts, back-links, link review state | **The SQLite cache** only, never committed |

This hybrid keeps headings short (usually just an ID and a status) while keeping heavy and tool-owned data out of the Markdown and away from editors that might damage it.

#### Costs of the Hybrid

- **Two places to look.** Specquer's UI hides the split by showing all attributes of a target together, but people outside Specquer need to know the rule.
- **One schema.** A single list of attribute names, each with its fixed location (inline or external) and allowed values, in Specquer's configuration. Specquer reports an attribute found in the wrong place.
- **Committing both together.** Specquer must write both files on save and warn when a commit includes one but not the other. A Git pre-commit check can enforce it.
- **Cleanup only from the default branch.** External records whose target no longer exists are removed only when the target is missing on the main branch, not just in the working copy, and only after confirmation.

## Problems the Design Must Handle <a name="obj007"></a>

- **Copy and paste duplicates IDs.** Copying a section copies its marker. Specquer has to detect duplicate IDs and assign a fresh one to the copy. The **identity algorithm** decides which section is the original.
- **Rewording.** With option E (slugs, no markers), Specquer could still act as a *refactoring tool*: when a heading is reworded in Specquer, it rewrites the links that point to it. That fails for edits made outside Specquer, by agents or other editors. The identity algorithm would then have to spot "renamed heading" between commits and offer a fix. That is a good fallback, but risky as the main mechanism.
- **Coding agents.** Agents must keep markers and IDs intact. That needs written conventions they read (an `AGENTS.md` or `CLAUDE.md` section), plus checks in Specquer that catch markers that are missing, duplicated or malformed.
- **Requirements smaller than a section.** Specs often state requirements as list items ("- The system shall …"), not headings. Option A works on a list item too: `- <a name="q8m1"></a>The system shall…`. It has to be decided whether only sections can be targets, or list items as well.
- **Moving between files.** With options a and b, a target moving to another file breaks the path even though the ID is unchanged. Specquer can fix it because it finds IDs by searching, not by path. Links are then rewritten on save, or reported as broken.

## Checks and Reports (the "Auditing" Part of the Scope) <a name="obj008"></a>

Once targets have IDs and links have types, Specquer can produce traceability reports:

- broken links;
- duplicate or missing IDs;
- suspect links;
- **orphans**, such as a requirement with no *verifies* link from a test plan;
- **coverage by work item**, such as which system sections a work item changed.

Testers are one of the listed user groups, and this is the view they would use.

## Existing Tools Worth Studying <a name="obj009"></a>

- **[OpenFastTrace](https://github.com/itsallcode/openfasttrace):** Markdown requirements, with an ID in backticks directly under the heading (`` `req~ai.example~1` ``) and keywords like "Needs: impl". Code links back to requirements with comments such as `// [impl->req~ai.example~1]`. The IDs include revision numbers to flag outdated links. ([An example in practice, from JabRef](https://devdocs.jabref.org/requirements).)
- **Doorstop, StrictDoc and Sphinx-needs:** requirement items stored in Git with fixed IDs and typed links. They are useful for checking which link types and reports matter, though their formats aren't plain Markdown.

## Recommended Combination (a Starting Point for Debate) <a name="obj010"></a>

1. **Target:** an empty HTML anchor on the heading line, `## Password rules <a name="r7k2"></a>`. Invisible everywhere and a real anchor everywhere.
2. **ID:** short random base-32, assigned by Specquer (or an agent) when a section first becomes a link target, **not** on every heading. That keeps most of the Markdown untouched.
3. **Link:** a reference-style link with the type as the title:

   ```md
   [Password rules][r7k2]

   [r7k2]: ../system/auth.md#r7k2 "refines"
   ```

   It is visible and clickable on GitHub, and file moves only touch the definitions at the end of the file.
4. **Visibility:** IDs are hidden in the Markdown and shown at display time, as Specquer badges or by the site's stylesheet. An optional `data-label` holds a human-friendly ID for teams that want one.
5. **Attributes:** split by who writes them. Small decisions made by people (`data-status`, `data-label`, owner) go inline as `data-*` attributes on the marker. Records written by tools (creation details, approvals, review history) go in committed files under `.specquer/shared/targets/`, one per target ID. Anything derivable stays in the SQLite cache.
6. **Database:** computed back-links, suspect-link tracking by content hash, and checks for duplicate and broken IDs.
7. **Fallback:** where Specquer *can't* rewrite the Markdown, the identity algorithm finds the target that moved or was reworded and offers a fix.

## Points Still to Debate <a name="obj011"></a>

- **Invisible or visible IDs.** In regulated fields, visible IDs like "REQ-12" are part of how people talk ("does this cover REQ-12?"). Is a badge in Specquer's UI enough, or should IDs be visible in the Markdown?
- **When IDs are assigned.** On every section (consistent, but noisy) or only when a section becomes a link target (minimal, but the first link changes the target file too)?
- **Reference-style or inline links.** Reference-style links keep paths in one place but split each link across two spots in the file, which some writers find awkward.
- **How link types are shown.** A title attribute (subtle, standard) or a visible lead-in (clear, but a convention people must follow)?
- **What can be a target.** Sections only, or list items too?
- **Display labels.** Are `data-label` values free-form, or must they follow a pattern and be unique? Does Specquer suggest the next label, which brings back the collision problem across branches, or leave labels to people?
- **Status values and inheritance.** What is the fixed list of statuses, who may change them, and does a status on a parent heading apply to its subsections?
- **Creation details.** Are `data-created-at` and `data-created-by` worth duplicating what Git records? How is an agent identified as the creator: as the person who prompted it, or as the agent?
- **Inline, external or both.** Is the hybrid's rule (people's decisions inline, tool records external) worth having two places to look? Or should everything go to one place: all inline for simplicity and context, or all external for clean Markdown and safety from editors?
- **Committed `.specquer` content.** External attributes require a committed part of `.specquer`. Is that acceptable, and how is its consistency with the Markdown enforced (Specquer warnings, a pre-commit check)?

## Sources <a name="obj012"></a>

- [GitHub: Basic writing and formatting syntax (section links, custom anchors, HTML comments)](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
- [OpenFastTrace](https://github.com/itsallcode/openfasttrace)
- [OpenFastTrace user guide](https://openfasttrace.itsallcode.org/user_guide/user_guide.html)
- [JabRef requirements (OpenFastTrace in practice)](https://devdocs.jabref.org/requirements)
