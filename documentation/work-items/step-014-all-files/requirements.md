<a id="WORK-00569" data-uid="hyk9kimb7fzw"></a>

<a id="WORK-00570" data-uid="ibqbagp3w4sg"></a>
# Step 014 - All Files

_Requirements for showing every file under the root folder in the folder pane, for viewing files other than Markdown, and for listing the files once instead of repeatedly. Drafted October 2026 from [the notes](notes.md), revised with the answers to the first review, then rewritten for the major revision: Specquer edits Markdown only and shows every other text file as a highlighted code block, with line numbers. Fenced code in Markdown previews is highlighted too. The decisions are in §7. Images in the Markdown preview were moved to [their own note](/notes/markdown-images)._

<a id="WORK-00571" data-uid="qove7vmqr6xv"></a>
## 1. Summary

Specs are reviewed beside the code, configuration and images they describe, but today Specquer shows and opens Markdown files only. Step 014 lets the folder pane show everything, and the file pane show what it lists. Editing stays what Specquer is for, and only for Markdown:

- **Folder pane:** a selector above the tree switches between **Specs**, the tree as it is today, and **All Files**. All Files shows every folder and file under the root, recursively, except what `.gitignore` hides, `node_modules`, `.git` and Specquer's protected files (R1, R2).
- **Markdown only is changed:** Markdown files open and are edited as today, wherever they are. Every other file can be viewed, never edited, renamed, copied, moved or deleted on its own (R2).
- **Text files:** a text file is shown as Specquer's Markdown preview would show it in a fenced code block, with the language worked out from the file name, highlighted by the preview pipeline and with a line number gutter (R3, R4).
- **Code in Markdown:** fenced code blocks with a language in Markdown previews are highlighted too (R4.3).
- **Images:** common image types up to 5 MB are shown, fitted to the pane (R5).
- **Other files:** anything else opens as a placeholder (R6).
- **Server and security:** a route lists all files, and any listed UTF-8 text file can be read. What can be written, renamed or deleted doesn't change. Files the tree hides can't be read, and no file other than Markdown goes to the model (R7, R8).
- **Performance:** the files are listed once and shared by everything that needs the list, fixing the code review's P1 as a stage of this step (R9).

<a id="WORK-00572" data-uid="zmw7fg0n5h5t"></a>
## 2. Precedence

Step 014 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 014 (wins) |
|---|---|---|
| Folder tree contents (Client Requirements §3 item 1, Server Requirements §3 item 1) | Folders and `.md` files only | **Specs**: unchanged. **All Files**: every file not excluded by R2.1 (R1, R2) |
| Folders never listed (Server Requirements §3 item 2) | `.git`, `.specquer`, `node_modules` | Unchanged for **Specs**. **All Files** lists `.specquer/` but not `.specquer/user/` or `.specquer/cache/` (R2.1) |
| Files that can be opened (Client Requirements §3 item 4) | `.md` files | Any listed file: Markdown, text, image or placeholder (R3, R5, R6) |
| Reading (Server Requirements §4 item 2, Security §5) | Existing `.md` files that are UTF-8 text | Existing listed UTF-8 text files of any type (R7.2) |
| Writing, renaming and deleting files (Server Requirements §4, Client Requirements §3) | `.md` files | Unchanged: `.md` files only, now enforced for rename and delete (R2.3, R7.4) |
| Fenced code in the preview pipeline (Client Requirements §6) | Not highlighted | Highlighted, in Markdown previews and in text files (R4) |
| Image bytes | Not served | `GET /api/image?path=` for the image types of R5, with strict headers (R7.3, R8.3) |
| UI state (Data Architecture §3) | No tree view | `treeView`: `specs` or `all` (R1.4) |
| The recent files and the current file | Markdown files | Any file that can be opened (R1.6) |
| Listing the files (Server Requirements §3) | Listed again by each tree load, scan, chat index update and save | Listed once and shared until it may be stale (R9) |

<a id="WORK-00573" data-uid="a8p238o1d4hl"></a>
## 3. Requirements

<a id="WORK-00574" data-uid="ykppp6ukqrgr"></a>
### R1. The Folder Pane's View Selector

1. **Selector:** a selector with two options, **Specs** and **All Files**, sits above the tree in the folder pane. It looks and behaves like the file pane's view selector (Text, Split, Preview, WYSIWYG): a radio group with an accessible name ("Files shown"), usable from the keyboard, with the chosen option marked.
2. **Specs:** the tree is as it is today: folders and Markdown files (Client Requirements §3).
3. **All Files:** the tree shows every folder and every file under the root, recursively, except those R2.1 excludes. Folders come before files, and names sort naturally, ignoring case, as today.
4. **UI state:** the choice is kept in `uistate.yaml` as `treeView` (`specs` or `all`). Its default is `specs`, and an invalid value becomes `specs`.
5. **Expanded folders:** both views share the expanded folders in the UI state. Expanding a folder in one view expands it in the other, where it exists.
6. **The open file:** switching views never closes or saves the open file. A file the current view doesn't show stays open, and nothing in the tree is highlighted for it. The recent files and the current file in the UI state can be any file that can be opened. At start-up, a current file that is no longer listed in any view is dropped, as today.
7. **Loading:** both views come from the one shared listing of R9. Switching views doesn't list the files again while that listing is fresh.
8. **Truncation:** the limits of Server Requirements §3 item 5 apply to each view separately. A truncated tree says so, with the limit, in the pane.
9. **File icons:** each file has an icon for its kind, worked out from its name so the tree needn't read the files (§5.2).
   - **Markdown:** keeps today's icon (Lucide's `FileText`).
   - **Other kinds:** text, image and other files get new icons in the same style.

<a id="WORK-00575" data-uid="aaxy9b7cb5a3"></a>
### R2. What Is Listed, and What Can Be Done There

1. **Hidden in All Files:**
   - **`.gitignore`:** in a Git work tree, files and folders ignored by `.gitignore` rules (nested ones and global excludes included) aren't listed. Outside a Git work tree, the server walks the folders, and only the next two items apply.
   - **`node_modules`** folders are never listed, at any depth, with or without Git.
   - **`.git`** and **Specquer's protected files**, `.specquer/user/` (the session's `instance.json` with its token, the chat history, approvals, UI state) and `.specquer/cache/`, are never listed, whatever `.gitignore` says.
2. **Shown in All Files:** everything else, including names starting with "." (`.gitignore`, `.github/`, `.vitepress/`, `.claude/`), `.specquer/` and the committed files in `.specquer/shared/`, `.specquer-config.yaml` files and comment sidecars.
3. **Only Markdown is changed.** Specquer doesn't edit, rename, copy, move or delete a file that isn't Markdown. That isn't its mission.
   - **Files other than Markdown** have no context menu, open view-only, and can't be dragged. ([Step 015](/work-items/step-015-folder-menu/task) gives every file and folder the same menu, `.specquer` included; actions that don't apply say why.)
   - **Markdown files** have today's menu and are edited as today, in either view and in any folder, names starting with "." included.
   - **Folders** keep today's menu (**New file…**, **New folder…**, **Settings…**, **Section problems…**, **Rename…**, **Delete…**). **New file…** still creates Markdown files only. Renaming or deleting a folder still takes everything in it along, after the delete dialog has listed it (Client Requirements §3.3), as today.
   - **Specquer's own files** keep changing only through their own paths: **Settings…** writes `.specquer-config.yaml`, the Comments pane writes sidecars, and the server writes the section data files.

<a id="WORK-00576" data-uid="y3c89b8jd3o6"></a>
### R3. Text Files

1. **What counts as text:** a file that is not Markdown (`.md`, in any case), is not an image type of R5, is valid UTF-8 and holds no NUL byte. A byte-order mark is allowed and isn't shown.
2. **Shown as a code block:** a text file is shown read-only in the file pane by the preview pipeline (`shared/markdown`, in the preview worker), as if it were a Markdown document holding nothing but the file in one fenced code block. For `index.ts`:

   ````md
   ```ts
   // content of the index.ts file here ...
   ```
   ````

   - **Language:** the fence's info string is the language R4 works out from the file name. A file of no recognized language gets no info string, and shows as plain text.
   - **Nothing else is Markdown:** the file's text is never parsed as Markdown. The pipeline builds the code node from the text directly (or, if it builds Markdown text, uses a fence longer than any run of backticks in the file), so nothing in the file can end the block, add HTML or change how it is shown.
   - **Look:** the code block's styling from the Markdown preview, filling the pane. Long lines scroll sideways rather than wrapping, as in a code block. The text can be selected and copied.
   - **Line numbers:** a gutter at the left of the block numbers every line, from 1, including a file shown without highlighting (R3.9).
     - It is as wide as the largest number, and stays in place when the block scrolls sideways.
     - The numbers aren't part of the text: they can't be selected, aren't copied with it, and are hidden from screen readers (`aria-hidden`).
     - Its colors are defined in `client/src/theme/palette.ts`, and checked for contrast like the others.
     - Only text files have it: fenced code in Markdown previews has no line numbers.
3. **What the pane holds:**
   - **Shown:** the file path (breadcrumb, recent files).
   - **Not shown:** the view selector, a save status, the front matter editor, section badges, the summary slider and comment pips.
4. **View only:** the text can't be changed in Specquer, so it is never saved and has no conflict dialog. A file changed on disk shows its new content when it is next opened.
5. **No more than viewing:** text files have no sections, anchors, summaries, comments, completion, linting or navigation. The view is meant for review.
6. **Not sent to the model:** text files aren't summarized, aren't in the chat's search index, and are never sent to the model provider.
7. **Comments pane:** while a text file is open, the Comments pane says that comments are available for Markdown files in sectioned folders, as it does today for a file that can't have threads.
8. **Size:** a text file larger than 5 MB isn't loaded. The pane shows a placeholder that names its size and says it is too large to display.
9. **Long lines:** a file whose longest line exceeds 10,000 characters (minified code, a lock file) is shown without highlighting, so rendering stays quick.
10. **Markdown-like files:** `.markdown` and `.mdx` files aren't Markdown files to Specquer: they aren't sectioned, previewed or editable. They are shown as text, highlighted as Markdown source.

<a id="WORK-00577" data-uid="zqfeficuw8fb"></a>
### R4. Syntax Highlighting

1. **In the preview pipeline:** code is highlighted by [`rehype-highlight`](https://github.com/rehypejs/rehype-highlight), the highlighter the unified ecosystem's own documentation lists for remark and rehype. It runs on the HTML syntax tree with `lowlight` (highlight.js grammars), so it works in the preview worker with no DOM and no styles inline.
2. **Languages:** its `common` set of grammars (§5.1). For a text file, the language is worked out from the file name with §5.1's table and written as the code block's info string. `rehype-highlight` isn't asked to guess (`detect` off), so a file of no recognized language stays plain text.
3. **Code in Markdown files:** fenced code blocks in the Preview and Split views are highlighted too.
   - **Language:** the info string's first word, as written (`ts`, `typescript`, `json`), matched against the names and aliases of `common`'s grammars, ignoring case.
   - **Plain:** a block without an info string, or whose language isn't in `common` (`mermaid`, `dockerfile`), and indented code, stay plain text, as today.
   - **Long lines:** a block whose longest line exceeds 10,000 characters isn't highlighted (R3.9).
   - **Unchanged elsewhere:** the WYSIWYG view (Milkdown renders its own code blocks), chat answers and comments show code as today. Summaries and the chat's search index use the Markdown text, not the highlighted tree.
4. **Sanitizing:** the sanitizer allows only highlight.js's `hljs` and `hljs-*` class names on the `code` element and the `span` elements inside it. Highlighting runs before sanitizing, and nothing in it can add other markup.
5. **Colors:** highlight colors are defined in `client/src/theme/palette.ts`, for light and dark mode. Its tests check that each token color has WCAG AA contrast on the code block's background.
6. **Loading:** the grammars are part of the preview worker, not the main bundle.

<a id="WORK-00578" data-uid="sbeue3bfkumc"></a>
### R5. Images

1. **Types:** PNG, JPEG, GIF, WebP, AVIF, SVG, BMP and ICO (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.bmp`, `.ico`, in any case).
2. **The image view:** the image is shown, view-only, centered in the file pane.
   - **Fit:** scaled down to fit the pane, never scaled up.
   - **Actual size:** clicking it, or Enter on it, switches between fitting and actual size. At actual size the pane scrolls.
   - **Transparency:** transparent areas show over a checkerboard that suits both themes.
   - **Details:** a line under the image gives its pixel size and file size.
3. **What the pane holds:** the file path and recent files. There is no save status, view selector, summary slider or comment pips.
4. **Animated images** (GIF, WebP, AVIF) play as the browser plays them.
5. **SVG** is shown only as an image, never inlined into the page and never as source text, so its scripts and links don't run (R8.3).
6. **Size:** an image larger than 5 MB isn't loaded. The pane shows a placeholder that names its size and says it is too large to display.
7. **A file that doesn't decode** (damaged, or not really an image) shows the placeholder of R6 with "This image can't be displayed."

<a id="WORK-00579" data-uid="on4stwk09v3m"></a>
### R6. Other Files

1. **Placeholder:** any other file opens as a placeholder in the file pane: "This file type cannot be displayed by Specquer." It names the file's size, and the path and recent files are shown as for any file.
2. **Text that isn't UTF-8** (UTF-16, Latin-1) gets a placeholder with its own message: "This file isn't UTF-8 text, so Specquer can't display it."
3. **No download or open-elsewhere action** in Step 014.

<a id="WORK-00580" data-uid="hn1vsz1nwb90"></a>
### R7. Server

1. **Tree:** `GET /api/tree` returns both trees, `{ specs, all }`, built from the shared listing (R9) under the exclusions of R2.1, so switching views needs no request (R1.7). Their limits and truncation are those of Server Requirements §3 item 5.
2. **Reading:** `GET /api/file` stays Markdown-only. `GET /api/view?path=` returns any other file that the **All Files** tree would list: its text, if it is UTF-8 without NUL bytes and at most 5 MB, that it is an image, or why it can't be shown (`binary`, `not_utf8`, `too_large`).
   - **Refused:** a file R2.1 hides (ignored by `.gitignore`, in `node_modules`, `.git`, `.specquer/user/` or `.specquer/cache/`) answers `404`, as if it didn't exist. A Markdown path answers `400`.
3. **Images:** `GET /api/image?path=` returns the bytes of an existing listed file whose extension is one of R5's, at most 5 MB.
   - **Content-Type:** set from the extension, never sniffed.
   - **Headers:** see R8.3.
   - **Other files:** a request for any other file answers `415`, one over the limit `413`, and a hidden one `404`.
   - **Confinement and authentication:** the path is confined and the session is checked like every route.
4. **Writing, renaming and deleting are unchanged:**
   - `PUT /api/file` writes only existing `.md` files, as today (Server Requirements §4 item 2). Any other path fails validation (`400`).
   - `POST /api/rename` and `DELETE /api/entry` act on folders and `.md` files. Any other file answers `400`, as renaming already did, with a message that Specquer changes only Markdown files.
   - A document's sidecar is still renamed and deleted with its document (Step 012).
5. **Size:** the file-size check happens before a file is read, so a large file is never loaded into memory to be refused.
6. **The model:** nothing in this step sends file contents anywhere but the browser (R3.6).

<a id="WORK-00581" data-uid="u6p70tom0wmp"></a>
### R8. Security

1. **Reading more than Markdown is new reach.** Before Step 014, a request with the session token could read only Markdown files. Now it can read any listed text file under the root, including source code and configuration. What can be written is unchanged, so a stolen token still can't change code.
   - The defenses against stealing the token are unchanged (Security §3, §4).
   - **Hidden files stay unreadable:** files `.gitignore` hides, which is where secrets such as `.env` usually are, can't be read, and neither can `node_modules`, `.git`, `.specquer/user/` (which holds the session token) and `.specquer/cache/`. Paths outside the root through symbolic links stay unreachable (Security §5).
   - Outside a Git work tree there is no `.gitignore` to hide secrets. The specification must say so plainly, with the token's greater reach.
2. **Displayed text is not rendered:** a text file is shown as the text of a code node. It is never parsed as Markdown or HTML, and the highlighter's output, for text files and Markdown code blocks alike, is sanitized (R4.4).
3. **Image responses** carry:
   - `Content-Type` from the extension;
   - `X-Content-Type-Options: nosniff`;
   - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`;
   - `Content-Disposition: inline`;
   - `Cache-Control: no-cache` with a weak `ETag` from the file's modification time and size, so the browser revalidates rather than downloading again, and a revalidation reads nothing.

   An SVG opened directly at its URL therefore can't run scripts in Specquer's origin. The page's own CSP (`img-src 'self'`) already allows these images.
4. **`.specquer/shared/`** exposes nothing new: those files are committed.

<a id="WORK-00594" data-uid="w33bmpm3u88f"></a>
### R9. Listing the Files Once

This fixes the code review's P1 ([Code Review](/work-items/step-013-code-review/code-review)) as a stage of this step, before **All Files** makes listings larger.

1. **One listing:** the server lists the files under the root once, every file not excluded by R2.1. The **Specs** and **All Files** trees, the read checks of R7.2, the section scan, the chat index update, pre-filling and **Section problems** all take what they need from it, rather than listing again.
2. **Kept while fresh:** the listing is reused until it may be stale:
   - Specquer's own create, rename, delete and save operations update or invalidate it;
   - a tree load always lists again, so changes made outside Specquer show on reload, as today;
   - the section scan, the chat index, pre-filling and the read checks reuse a listing for at most 2 seconds.
3. **Fewer file-system calls:** tracked files deleted from disk are found with Git (`git ls-files --deleted`) rather than a `stat` of every listed file. Where `stat` is still needed, the calls run with bounded parallelism.
4. **Saves still list.** A save that reused an older listing could issue an ID that an agent had just written into another file, or drop from the data files the sections of a file pulled in meanwhile. So every operation that writes the data files (a save, a create, a rename, a delete, renumbering, **Add section anchors**) lists again; only scans and lookups reuse a listing. Without the `stat` of each file, a listing costs far less than before.
5. **Measured:** a test counts the listings. One tree load lists once for the tree, the scan, the chat index and pre-filling; a save lists once; switching views lists not at all.

<a id="WORK-00582" data-uid="g5olmd35tyez"></a>
### R10. Tests

1. **Shared:**
   - the `treeView` field and its default;
   - file kinds by name (Markdown, text, image, other);
   - languages by file name;
   - a text file's code block: the info string, no info string for an unknown language, a file holding backtick fences and HTML shown as text, no highlighting for long lines, and its line numbers;
   - fenced code in Markdown: highlighted by a grammar's name and by an alias, in any case; plain for no info string, an unknown language, indented code and long lines;
   - the sanitizer keeping `hljs-*` classes and dropping anything else.
2. **Server:**
   - the **All Files** listing in and outside a Git work tree, with `.gitignore` rules, nested `node_modules`, `.specquer/shared/` listed, and `.specquer/user/` and `.specquer/cache/` never listed;
   - reading a text file with CRLF line endings and a byte-order mark;
   - refusals: a hidden file (`404`), and renaming or deleting a file other than Markdown (`400`); what `GET /api/view` says of non-UTF-8, NUL bytes and over 5 MB;
   - the image route's headers, `ETag`, size limit and refusal of other types;
   - the listing counts of R9.5.
3. **Components:**
   - the selector and its UI state;
   - the views sharing expanded folders, and the open file surviving a switch;
   - the icons, and no context menu for files other than Markdown;
   - the text view: highlighted, with its line number gutter, without Markdown's tools;
   - a Markdown file's highlighted code block in Preview and Split;
   - the image view's fit and actual size, and the placeholders;
   - the Comments pane's message for a text file.
4. **End-to-end:** in Chrome and WebKit:
   - switch to **All Files**;
   - open a TypeScript file and see it highlighted, with line numbers, and copy text without them;
   - see a fenced code block highlighted in a Markdown file's preview;
   - see that a file `.gitignore` hides is neither listed nor readable;
   - open a PNG and an SVG;
   - open a binary file and see the placeholder.

<a id="WORK-00583" data-uid="wtorkkjj70ss"></a>
## 4. Out of Scope

- Editing, renaming, copying, moving or deleting files other than Markdown, and creating them.
- Images in the Markdown preview: deferred to a later step ([note](/notes/markdown-images)).
- Code intelligence of any kind: completion, go to definition, linting, formatting, language servers.
- Comments on files other than Markdown, or on lines of code.
- Viewing SVG source.
- PDFs, notebooks, archives and office documents beyond the placeholder.
- Diff views of a file against Git.
- Text encodings other than UTF-8.
- Search across files that aren't Markdown, and chat about them.
- Languages beyond `lowlight`'s `common` set (Dockerfile, PowerShell, Vue, Sass and others), until they are missed.
- Highlighting in the WYSIWYG view, chat answers and comments, and line numbers in Markdown code blocks.

<a id="WORK-00584" data-uid="yuh38ma8ee6w"></a>
## 5. Supporting Lists

<a id="WORK-00585" data-uid="xcp025u5jsp0"></a>
### 5.1 Languages

The languages are those of `lowlight`'s `common` set, which `rehype-highlight` uses by default: highlight.js's 37 most used grammars. For a text file, the info string is the grammar's name, from the file names in the table, which are Specquer's choice. In Markdown, highlight.js's own aliases (`ts`, `js`, `py`, `html`, `sh`, `yml`) work as info strings too (R4.3).

| Info string | Language | File names |
|---|---|---|
| `javascript` | JavaScript, JSX | `.js` `.mjs` `.cjs` `.jsx` |
| `typescript` | TypeScript, TSX | `.ts` `.mts` `.cts` `.tsx` |
| `json` | JSON | `.json` `.jsonc` `.json5`, `bun.lock` |
| `css`, `scss`, `less` | CSS, SCSS, Less | `.css`, `.scss`, `.less` |
| `xml` | HTML, XML | `.html` `.htm` `.xhtml` `.vue` `.xml` `.xsd` `.xsl` `.plist` |
| `yaml` | YAML | `.yaml` `.yml` |
| `markdown` | Markdown source | `.markdown` `.mdx` (R3.10) |
| `ini` | INI, TOML | `.ini` `.cfg` `.toml` (`mise.toml`, `bunfig.toml`), `.editorconfig`, `.gitconfig` |
| `bash` | Shell | `.sh` `.bash` `.zsh`, `.envrc` |
| `python` | Python | `.py` `.pyi` |
| `java`, `kotlin` | Java, Kotlin | `.java`, `.kt` `.kts` |
| `c`, `cpp` | C, C++ | `.c` `.h`, `.cpp` `.cc` `.cxx` `.hpp` `.hh` |
| `csharp`, `vbnet` | C#, Visual Basic .NET | `.cs`, `.vb` |
| `objectivec`, `swift` | Objective-C, Swift | `.m` `.mm`, `.swift` |
| `go`, `rust` | Go, Rust | `.go`, `.rs` |
| `php`, `ruby`, `perl`, `lua`, `r` | PHP, Ruby, Perl, Lua, R | `.php`; `.rb` `Gemfile` `Rakefile`; `.pl` `.pm`; `.lua`; `.r` |
| `sql`, `graphql` | SQL, GraphQL | `.sql`, `.graphql` `.gql` |
| `diff` | Diff | `.diff` `.patch` |
| `makefile` | Make | `Makefile`, `GNUmakefile`, `.mk` |
| `wasm`, `arduino` | WebAssembly text, Arduino | `.wat`, `.ino` |

`common` also has `plaintext`, `shell` (console sessions), `python-repl` and `php-template`, which no file name maps to. Matching ignores case, except for whole names (`Makefile`, `Gemfile`). Everything else is plain text with no info string: `.txt`, `.log`, `.csv`, `LICENSE`, `Dockerfile` (not in `common`), `.gitignore`, `.env`.

<a id="WORK-00586" data-uid="ab1y8ctslwu6"></a>
### 5.2 File Kinds by Name

| Kind | Rule | Opens as | Icon |
|---|---|---|---|
| Markdown | `.md`, in any case | Today's Markdown views, editable | Today's (`FileText`) |
| Image | An extension of R5.1 | Image view (R5) | New: image |
| Text | Anything else that turns out to be UTF-8 without NUL bytes and at most 5 MB | Code block (R3) | New: text or code |
| Other | Anything else | Placeholder (R6) | New: other |

The tree can't tell text from other files without reading them. It shows the text icon for names in §5.1, for files without an extension, and for other names not known to be binary. It shows the other icon for known binary extensions (`.pdf`, `.zip`, `.exe`, `.woff2`, `.db`, …). The file pane decides when the file is opened.

<a id="WORK-00587" data-uid="k5tmb2gozyxc"></a>
## 6. Specifications to Update

- **Client Requirements:**
  - §2 and §3: the selector, the two views, the icons, context menus only for folders and Markdown files;
  - a new section for the text view with its line numbers, and the image and placeholder views;
  - §6: highlighting fenced code in the Preview and Split views.
- **Server Requirements:**
  - §3: the shared listing, the exclusions and both views;
  - §4: reading text files, refusing hidden files, the image route, Markdown-only rename and delete, the 5 MB limits.
- **Security:**
  - §5: what can be read, hidden files unreadable;
  - a new item on the session token's greater read reach, and on roots outside Git (R8.1);
  - the image route's headers (R8.3);
  - §7: the highlighter's classes in the sanitizer;
  - §9: files other than Markdown never go to the model.
- **Data Architecture:** §3, `treeView`, and the recent and current files that aren't Markdown.
- **Technical Architecture:** `rehype-highlight` in the preview worker, the image route, the shared listing.
- **`CLAUDE.md`:** the new client components, the highlighter and the shared listing.
- **Code Review note:** mark P1 fixed when R9 is done.

<a id="WORK-00588" data-uid="gdrf2qqsc7gk"></a>
## 7. Decisions

From the first review, and the major revision that replaced most of it:

| Topic | Decision | Where |
|---|---|---|
| Editing | Specquer edits, renames and deletes Markdown files only. Every other file is view-only: no edit toggle, no read-only rules by name | R2.3, R7.4 |
| Viewing text | As the Markdown preview shows a fenced code block, with the language from the file name, or none | R3.2 |
| Highlighting | `rehype-highlight` with `lowlight`'s `common` grammars, the highlighter the unified documentation lists | R4, §5.1 |
| Code in Markdown | Fenced code blocks in Markdown previews are highlighted in this step too | R4.3 |
| More languages | Not in this step: `common` only, more in a future step | §4 |
| Line numbers | A gutter in the text view; not in Markdown code blocks | R3.2 |
| What **All Files** lists | Everything except what `.gitignore` hides, `node_modules`, `.git` and Specquer's protected files | R2.1 |
| Specquer's protected files | `.specquer/user/` and `.specquer/cache/`, hidden. `.specquer/shared/` is committed and shown | R2.1, R2.2 |
| Names starting with "." | Listed and shown like any other file; Markdown among them stays editable | R2.2, R2.3 |
| The name **Specs** | Kept, although the view also shows Markdown that isn't a spec | R1.1 |
| Images in Markdown | Moved out of this step, to [a note](/notes/markdown-images) | §4 |
| Comments on code | Not in this step | §4 |
| Limits | 5 MB for text and images, 10,000 characters for a long line, to start with | R3.8, R3.9, R5.6 |
| SVG source | Not shown | R5.5 |
| Folders holding other files | Renamed and deleted with everything in them, as today | R2.3 |
| Listing freshness | Up to 2 seconds old, as written; no file-system watching | R9.2 |
| Expanded folders | Shared by both views | R1.5 |
| Icons | Today's icon for Markdown, new ones for the other kinds | R1.9, §5.2 |
| Listing performance | The code review's P1 is fixed as a stage of this step | R9 |

<a id="WORK-00589" data-uid="ci4yjdl45xde"></a>
## 8. Open Questions

None at the moment: the answers to the second review are in §7.

<a id="WORK-00590" data-uid="jqs3cix1okcl"></a>
## 9. Risks

1. **Large files in the preview.** A highlighted 5 MB file is a large HTML tree: `lowlight` wraps every token in a `span`, and the line number gutter adds an element per line. The work is in the preview worker, but the DOM still has to hold it. The limits of R3.8 and R3.9 may need to come down, or highlighting stop above a smaller size, once measured.
2. **Highlighting while typing.** The Split view renders the preview again as the user types, and now highlights every code block each time. A document with much code could make the preview lag. If it does, highlighted blocks can be reused while their text and language are unchanged, or renders that are already out of date skipped.
3. **Large repositories.** **All Files** reaches the 10,000-file limit far sooner than **Specs**. R9 keeps the cost of listing to one pass per tree load, but a tree that loads folder by folder may still be needed later.
4. **Secrets outside `.gitignore`.** A secret that isn't ignored (a committed `.env`, a key file outside Git) can be read through the API by anyone holding the token, and is shown in the tree. Specquer only shows what is already in the folder, but the reach is new (R8.1).
5. **Misdetecting text.** A file that is UTF-8 by accident (some binary formats, small files) is shown as text. The NUL byte check catches most of these, and since nothing is saved, the cost is only a strange view.
6. **The bundle size of the preview worker.** `common` adds a few hundred kilobytes to the worker. It loads once, outside the main bundle, so this is acceptable unless the worker's start-up slows the first preview noticeably.

<a id="WORK-00591" data-uid="gq227n52j8cc"></a>
## 10. References

- [Step 014 notes](notes.md)
- [Images in the Markdown Preview](/notes/markdown-images), the part of this step deferred
- [Client Requirements](/specifications/client-requirements), [Server Requirements](/specifications/server-requirements), [Security](/specifications/security), [Data Architecture](/specifications/data-architecture)
- [Code Review, October 2026](/work-items/step-013-code-review/code-review), P1
- [`rehype-highlight`](https://github.com/rehypejs/rehype-highlight), [`lowlight`](https://github.com/wooorm/lowlight) and its `common` grammars, [highlight.js languages](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md)
