# Specquer Development - Step 001 - Simple Markdown file editor/browser

## Execution Context

* Specquer focuses on a collection of Markdown files kept in a folder structure in Git.
* Specquer is launched from the command line as `specquer [root] [--port <n>] [--no-open]`.
* The root folder is the optional `root` argument (absolute or relative to the working directory),
  defaulting to the working directory where the application was launched. Specquer exits with an
  error if it doesn't exist or isn't a folder.
* On launch, Specquer opens its URL in the default browser and also prints the URL. `--no-open`
  skips opening the browser (for example for a future desktop shell or for coding agents).
* Without `--port`, Specquer tries a default port and falls back to a free one, so it can run
  in several folders at once.
* Spec files make typical use of nested hierarchical Markdown headings (#, ##, ###, etc.).
* Files support GitHub Formatted Markdown.
* Files support YAML frontmatter.
* Files *do not* support MDX.
* Specquer maintains the user's UI state in file .specquer/user/uistate.yaml, where 
  .specquer is a direct subfolder of the root folder. Henceforth, this is just called uistate.yaml.
* If Specquer is open in several browser tabs or windows, the last write to uistate.yaml wins.
* When Specquer creates folder .specquer/user, it also creates .specquer/user/.gitignore containing
  `*`, so that per-user state is never committed to Git. An existing .gitignore there is left unchanged.

## Markdown Documentation Viewer

The primary (and so far only) view of Specquer consists of a typical split pane with folder structure on the left
and a selected file open on the right.

### Left Pane

* The left pane shows a typical tree view of folders and files.
* The tree starts at the root folder.
* Only *.md files are shown.
* The tree skips .git, .specquer and node_modules, respects .gitignore, and hides folders that
  contain no *.md files.
* A file is opened in the right pane by single clicking it in the left pane.
* The folder view as a fraction of the display can be widened or narrowed with a drag bar. This change
  persists in file uistate.yaml.
* Individual folders can be expanded or collapsed; their collapse state is remembered in folder
  uistate.yaml.
* The following operations are available by right-clicking on a folder name:
  - Rename (with modal dialog using a text box, a "Rename" button and a "Cancel" button)
  - Delete (with modal dialog holding a "Delete" button and a "Cancel" button)
* The following operations are available by right-clicking on a file name:
    - Rename (with modal dialog using a text box, a "Rename" button and a "Cancel" button)
    - Delete (with modal dialog holding a "Delete" button and a "Cancel" button)
* Rename changes only the name; it never moves a file or folder to a different folder. A file's
  extension (.md) cannot be changed. If the new name collides with an existing file or folder,
  the rename dialog stays open and shows an error.
* The delete dialog for a folder lists everything that will be deleted, including files the tree
  doesn't show, and warns about files that aren't committed to Git.
* Single clicking a file opens it in the right pane (below)

### Right Pane

* The right pane is split vertically into three components, stacked top to bottom:
  - File Path
  - Frontmatter
  - Markdown Content

#### File Path

* The file path is shown starting from the root folder.
* If necessary the highest level folder(s) is(are) elided with "..." to make the path fit the 
  available space.
* After a different file is selected in the left pane, the file path component becomes a drop 
  down component. The last up-to-ten files viewed or edited by the user (not counting the current one)
  are shown in the drop-down. Selecting a drop-down item changes to that file for frontmatter 
  and Markdown content.
* The list of recent files persists across restarts in uistate.yaml. It includes files opened
  from the drop-down as well as from the left pane.
* Renaming a file or folder in Specquer updates the affected entries in uistate.yaml (recent files,
  expanded folders, per-file settings); deleting one removes them.
* The path is built with a shadcn breadcrumb component.

#### Frontmatter

* The YAML frontmatter for the file is edited in its own distinct text area.
* CodeMirror is used for editing.
* If the file has no frontmatter, the editor takes up just one line. Otherwise, it
  starts out with three lines visible.
* The editor for frontmatter can be expanded vertically by the user using a drag bar.
* The position of the frontmatter drag bar is remembered for each different file
  in uistate.yaml.
* The "---" delimiters are not included.
* Typing into the empty one-line editor of a file without frontmatter adds a frontmatter block
  to the file; clearing the editor removes the block.
* Frontmatter is not validated against any schema. Invalid YAML is kept and saved as typed.

#### Markdown Content

* The right pane Markdown content view can be switched between four view type options:
    - editable plain text
    - a split view with editable plain text left and read-only preview HTML right
    - styled HTML output (read-only)
    - WYSIWYG editable rich text
* The user's choice of view type is persisted in uistate.yaml for every file they have opened.
* The default is editable plain text when a file is opened for the first time.
* The editable plain text view is implemented with CodeMirror.
* The read-only preview HTML is produced by a unified/remark pipeline defined in the shared
  subsystem (remark-parse, remark-gfm, remark-frontmatter, remark-rehype) and rendered to React
  with hast-util-to-jsx-runtime. Parsing may run in a Web Worker so that editing stays responsive.
* Editable WYSIWYG rich text is editable with Milkdown.
* Only one file at a time is open at a time; there are no file tabs.
* Edited file content is saved automatically:
  - before a different file is opened, 
  - when the browser tab loses focus, or 
  - every 60 seconds (if there are changes).
* Opening a file in the WYSIWYG view without editing it never changes the file. Milkdown's output
  is only written when the user has made a change.
* If the file changed on disk since it was opened (for example by a coding agent), saving doesn't
  overwrite it. A dialog offers to reload the file from disk or to keep the user's version.

## Front End

### Technologies

The following front end technologies are used:
* React
* Tailwind CSS
* shadcn
* unified, remark and rehype (for the Markdown preview pipeline)
* hast-util-to-jsx-runtime
* CodeMirror
* Hono
* Zod
* Milkdown 
* yaml (front matter validation in the browser)

### Theme

The following CSS colors predominate for normal components of the application:
- #081f37 - main document text color
- #fafafa - document background color
- #5fc9f3 - Secondary buttons, etc.
- #2e79ba - Primary buttons, etc.
- #1e549f - Navigation, menus, etc.
- #2e79ba and #1e549f are background colors for light text, #fafafa.
- #5fc9f3 is a background color for dark text, #081f37, because light text on it is too hard to read.

The error color is:
- #cf4647

The warning color is:
- #f5d061 (a background color for dark text, #081f37)

All of these should be easily changeable in one place.

The application has light mode and dark mode user-switchable.
* On first launch, the mode follows the browser's preference. The user's choice is saved in
  uistate.yaml.
* Dark mode colors are derived automatically from the colors above, so only the light-mode
  colors need to be specified.
* Text colors on colored backgrounds are chosen automatically for contrast (at least 4.5:1, WCAG AA).


## Back End

### Technologies

* Bun
* Hono
* Bun.YAML

### Security

Harden the localhost server, since it can edit files: 
- listen on localhost only, 
- require a random session token in the launch URL, and 
- check the Origin and Host headers, and
- send a Content-Security-Policy header with the application page.

Markdown files are untrusted input. Raw HTML in them is rendered in the preview only after
sanitizing (rehype-sanitize with a strict list of allowed tags and attributes).

## Shared

* Make it easy to add a shell later. The UI should rely only on HTTP to its own server (no browser-only
  APIs it can't do without), and the server shouldn't assume a browser tab. Then wrapping it in Tauri
  or Electrobun at some future time is a packaging job, not a rewrite.
* Markdown folders and files are the shared domain. Operations on Markdown content should be in the "shared" subsystem
  to the extent possible even if only used by the client at this early stage of development. Plan for
  Markdown parsing, AST rewriting, add-on functionality, and so on that is needed by both client and server.
  Note that this refers to the Markdown content, not the server only details of reading and writing files.
* Use a shared domain model for user UI state since it is read by the client and written by the server.

## Testing

* Tests are written in three layers:
  - Unit tests (shared domains, server routes, security checks) with Bun.test.
  - Component tests for React components that don't need a real browser (tree, dialogs,
    breadcrumb, theme switching) with Bun.test, happy-dom and React Testing Library.
  - End-to-end tests in a real browser (launch with token, CodeMirror and Milkdown editing,
    autosave, view switching) with Playwright's test runner, run on the Bun runtime
    (`bun --bun x playwright test`).
* End-to-end tests run against Chrome, and also against WebKit, the engine a future desktop
  shell would use on macOS and Linux.

## Changes to system documentation

* Update technical-architecture.md to cover the technologies mentioned here.
* Create specifications/security.md to specify security concerns.
* Create specifications/info-architecture.md to outline the application's information architecture.
* Create specifications/client-requirements.md to capture the front-end requirements herein.
* Create specifications/server-requirements.md for server side requirements.
* Create specifications/markdown-domain-design.md for Markdown file content code.
* Create specifications/uistate-domain-design.md for persistent UI state.
* Link all these into the VitePress navigation.
