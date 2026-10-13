<a id="WORK-00364" data-uid="w00u7idpeqwz"></a>

<a id="WORK-00365" data-uid="u3i96vw4bknz"></a>
# Step 010 - Document Chat

_Requirements for a chat pane that answers questions about the specifications, grounded in the repository's Markdown files and citing the sections it used. Drafted October 2026._

<a id="WORK-00366" data-uid="fc73z29tac8c"></a>
## 1. Summary

Specquer shows and summarizes specs, but it can't yet answer a question about them: "what happens to a section's ID when it is copied?", "which steps changed the settings dialog?". Step 010 adds a chat pane for such questions:

- **The pane:** a third pane, to the right of the file pane, toggled from the header (R1).
- **Asking and answering:** answers stream in as the model writes them, in a box like an AI summary's (R2, R3).
- **Grounding:** every question is grounded in the Markdown files the folder tree shows, found with SQLite full-text search (FTS5) and sent with the question; nothing extra leaves the machine to build the search index (R4).
- **Citations:** answers cite the sections they used, as links that open the document at the section (R5).
- **History:** the conversation is kept per user in `.specquer/user/chat-history.yaml`, feeds into later answers, and can be cleared (R6).

Answers are untrusted model output. They are rendered as a limited subset of Markdown, and the only links in them are citations the server checked (R3, R5).

<a id="WORK-00423" data-uid="pd74uhwjqsy7"></a>
## 2. Precedence

Step 010 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 010 (wins) |
|---|---|---|
| Screen layout | A header and two panes | A header and up to three panes: folders, file, chat (R1) |
| Agent features | Summaries and the model test | Also chat (R2–R6), on LangChain.js; `model:` in `agent.config.yaml` applies to it too |
| Model output in the page | Summaries, as plain text only | Also chat answers, as limited Markdown with checked citations (R3, R5) |
| What the server sends the provider | Section text for summaries; the fixed test prompt | Also a question, the retrieved text and the conversation (R4, R6) |
| Files in `.specquer/user/` | `uistate.yaml`, `agent.config.yaml`, the instance files | Also `chat-history.yaml` (R6) |
| Files in `.specquer/cache/` | `summaries.db` | Also `search.db` (R4) |
| Output from the server | JSON responses | Also a stream of server-sent events for `POST /api/chat` (R7) |

<a id="WORK-00424" data-uid="jjwwod719l75"></a>
## 3. Requirements

<a id="WORK-00425" data-uid="ci1hpj4p82rx"></a>
### R1. The Chat Pane

1. **Toggle:** a **Chat** button in the header, left of the light/dark toggle, opens and closes the pane. It is a toggle button with the accessible name "Chat", `aria-pressed`, and a lucide icon (such as `MessageSquare`). The settings gear stays rightmost.
2. **Place:** the pane opens to the right of the file pane, with a drag bar between them. The folder pane stays on the left.
3. **Width:** the drag bar works like the one beside the folder pane: dragging, or the arrow keys on it. The width is a fraction of the window between 0.15 and 0.5, default 0.3.
4. **Limits:** the file pane never gets narrower than 30% of the window. When the folder and chat panes together would leave less, the pane being dragged stops; when the window shrinks, the chat pane gives way first. Every view stays available with the chat open, including Split, even though it is cramped in a narrow window.
5. **UI state:** `chatOpen` (default `false`) and `chatPaneFraction` (default 0.3) are new optional top-level fields of `uistate.yaml`, so its `version` stays 1. A reload or a restart reopens the pane as it was.
6. **Without a model or key:** the pane opens, but the input is disabled, with a hint naming `.specquer/shared/agent.config.yaml` and the reason as a tooltip, as for the summary slider (Client Requirements §6.2 item 5). The client asks for the status at the same times as for summaries, so a configuration change needs no reload.

<a id="WORK-00426" data-uid="zi5tu3j8o81c"></a>
### R2. Asking

1. **Input:** a text area at the bottom of the pane. **Enter** sends the question; **Shift+Enter** starts a new line.
2. **IME:** Enter while an input-method composition is under way (Japanese, Chinese and similar input) confirms the composition and doesn't send.
3. **Blank:** Enter on an empty or blank input does nothing.
4. **Length:** a question holds at most 8,000 characters; the input says so when it is longer, and doesn't send it.
5. **Saving first:** sending a question first saves unsaved changes to the open file, the same save autosave would do (Client Requirements §7), so the answer is grounded in what the user sees. That save may add section anchors to a sectioned file, as any save does.
   - With nothing to save, the question is sent at once.
   - If the file changed on disk, the conflict dialog opens as for any save, and the question waits until the user chooses.
   - If the save fails, the question isn't sent; it stays in the input, and the save error shows as usual.
6. **After sending:** the question appears in the conversation, the input is emptied and keeps focus.
7. **Stop:** while an answer is under way, a **Stop** button replaces the send button. Stopping aborts the request (R3.6). Only one question is answered at a time; Enter does nothing until the answer has ended.
8. **Commands:** `/clear` clears the conversation (R6.5). Any other input starting with `/` is answered with "Unknown command" under the input, and not sent.

<a id="WORK-00427" data-uid="m9uzwfqrlmrc"></a>
### R3. Answers

1. **Streaming:** an answer streams into its box as the model writes it.
2. **Before the first words:** the box shows "Searching the specs..." while the server retrieves (R4), then "Thinking..." until the first words arrive, each with a spinner that stays still when the system asks for reduced motion, as for summaries.
3. **Layout:**
   - **The user's questions** sit against the pane's right edge, as typed, in plain text (never rendered as Markdown). The box is at most 85% of the pane's width, and lines inside it are left-aligned, so a question of several lines stays readable.
   - **Answers** sit against the left edge.
4. **The answer box:** looks like an AI summary's (Client Requirements §6.2 item 7). The two share one component, so they can't drift. Its label holds:
   - the `Sparkles` icon and "AI response";
   - the model's name (the part after the last `/`, with the full ID as a tooltip);
   - the **thinking time**: the full elapsed time, measured on the server from receiving the question (retrieval included) to the end of the answer, e.g. "12 s";
   - the **clock time** of the answer: local time, with the date when it isn't today.
5. **Rendering:** limited Markdown, rendered again as text arrives, at most a few times a second. Unfinished syntax (an open `**`) shows as text until it is completed.
   - **Allowed:** paragraphs; bold and italic; bulleted and numbered lists, nested; inline code and fenced code blocks; block quotes; GFM tables.
   - **Shown as text:** raw HTML, images, links and autolinks the model writes, headings (as bold paragraphs, so an answer can't pass for part of a spec), footnotes and front matter.
   - **Links:** only citations (R5).
   - The answer is rendered through React (`hast-util-to-jsx-runtime`), never with `innerHTML`.
6. **Stopping:** **Stop** ends the answer where it is. The text received stays, labeled "stopped", with the time until it was stopped, and is kept in the history.
7. **Errors:** without a model or key, `503`, as for summaries. The provider's rate limit or another failure, before or during the answer, shows in the answer's place with **Retry**; text already received stays above the error. **Retry** asks the same question again from the start. A question that failed isn't kept in the history.
8. **Copy:** each answer has a **Copy** button that copies its Markdown.
9. **Scrolling:** the conversation follows a streaming answer, unless the user has scrolled up.
10. **Accessibility:** a streaming answer has `aria-busy`, and is announced once, when it ends, through a polite live region; tokens are never announced one by one.

<a id="WORK-00428" data-uid="sdppw0aqcq7o"></a>
### R4. Grounding

1. **Which files:** every Markdown file `GET /api/tree` lists, sectioned or not, by the same rules (Git's ignore rules; never `.git`, `.specquer` or `node_modules`; the 10,000-file limit; Server Requirements §3). A file the tree doesn't show is never searched or sent.
2. **Saved text only:** the index holds the files as saved, never unsaved edits, as for summaries (R2.5 saves first).
3. **Units:** each file is split by its headings, with the outline the summary slider uses (Data Architecture §1.5).
   - A unit is a heading section's lead text, with the titles of the headings above it. The text before a file's first heading is a unit too.
   - Each unit records its path, its outline path, its heading title and, when the heading has a section anchor, its section ID.
   - The text is simplified as for summaries (`simplifySectionText`: anchors removed, whitespace normalized). Front matter isn't indexed.
4. **The index:** an SQLite FTS5 table in `.specquer/cache/search.db`, through `bun:sqlite` (FTS5 is available in Bun 1.4.2, so in the release executable too).
   - It is per user and ignored by Git, like the summary cache.
   - The tokenizer is `porter unicode61 remove_diacritics 2`: English words match their other forms ("requirement", "requirements"). Specquer's specs are in English; other languages still match whole words, without stemming.
   - A file is indexed again when its modification time or size changes.
   - A database that can't be read is moved aside and created again; the index never stops the server.
5. **Freshness:** the index is brought up to date in the background after saves, creates, renames, deletes and tree loads, and by the chat route before it searches, so files changed outside Specquer are found.
6. **The query:** the question is split into words. Stop words are dropped, each term is quoted, and the terms are joined with `OR`, so FTS5's own syntax (`"`, `*`, `-`, `NEAR`) in a question can't break or steer the search. Results are ranked with `bm25()`, with heading titles weighted above body text. A follow-up question also searches with the previous question's terms.
7. **The open document:** its units rank higher than others, and its first unit is always included.
8. **Budget:** at most `chat.units` units (default 8), within `chat.contextTokens` (default 12,000, estimated at four characters a token). A unit longer than its share is cut.
9. **What leaves the machine:** building the index sends nothing. A question sends the provider the question, the retrieved units with their paths and headings, and the conversation (R6.3).

<a id="WORK-00429" data-uid="bw1uf7v3pcdm"></a>
### R5. Citations

1. **The list:** before the answer's text, the server sends the retrieved units as a numbered list: number, path, outline path, section ID (if any), heading title.
2. **Markers:** the prompt asks the model to cite those units as `[1]`, `[2]`.
3. **Links:** the client turns a marker into a link only when its number is in the list. Any other marker stays text. Since only retrieved units from files the tree shows are in the list, every citation leads somewhere real.
4. **Sources:** under the answer, a "Sources" line lists the units the answer actually cited, by heading title and path, as links.
5. **Opening a citation:**
   - **With a section ID:** like any section link (`other.md#SPEC-00012`; Client Requirements §6 item 5).
   - **Without one:** opens the file and scrolls to the heading by its outline path (`data-outline-path`, which the preview sets on top-level headings). If that heading no longer exists, the file opens at the top.
   - The open file is saved first, as for any file switch. A summary hiding the section moves the slider to the full text, as for section links (§6.2 item 9).
   - **The view:** a citation always shows the section in the preview. From the Text or WYSIWYG view, the file opens in Preview, and Preview becomes its remembered view type, as if the user had chosen it. Split and Preview stay as they are, since both show the preview.

<a id="WORK-00430" data-uid="j7zmfrhbfrho"></a>
### R6. History

1. **One conversation per root folder.** It is kept in `.specquer/user/chat-history.yaml` (per user, ignored by Git), written atomically after each answer ends. YAML stays the format, readable and consistent with the other files, unless rewriting the whole file after each answer turns out to be a problem in practice; JSON lines, which only append, are the fallback.
2. **What is kept:** for each question, the text and the time it was sent; for each answer, its Markdown as the model wrote it, the model's ID and name, the thinking time, the clock time, whether it was stopped, and its citation list (R5.1) as it was. Answers are rendered when shown, so later fixes to the rendering apply to old answers too.
3. **Sent to the model:** the conversation feeds into each new answer: the questions and answers of the last `chat.historyTurns` turns (default 10), within `chat.historyTokens` (default 8,000), newest kept first. Earlier retrieved units aren't sent again; a follow-up question is searched with the previous question's terms (R4.6) instead.
4. **Kept on disk:** at most 200 questions with their answers; older ones are dropped when the file is written. The limit is a starting point, to revisit if it proves too small or too large.
5. **Clearing:** a **Clear** button in the pane's header, or `/clear`, empties the conversation on screen and in the file. For ten seconds, a notice offers **Undo**, which puts it back. Later questions start a new conversation.
6. **Repainting:** opening the pane, reloading the page or restarting Specquer shows the conversation as it was first shown, from the file. Citations with a section ID are looked up again, so they follow moves and renames. A citation whose file no longer exists is shown as text, marked "no longer exists".
7. **Several tabs:** the pane reads the history again when the tab gets focus. If two tabs send questions at once, both are kept, in the order they ended.
8. **Damaged file:** a history file that isn't valid is moved aside (`chat-history.yaml.damaged-<time>`) and an empty conversation starts; it never stops the server.

<a id="WORK-00431" data-uid="nf928as5jjyn"></a>
### R7. Server and Configuration

1. **Routes**, in the shared router like every route:
   - `POST /api/chat`: body `{ question, openFile? }`. Answers with a stream of server-sent events, each described by a Zod schema in `shared`: `status` (`searching`, `thinking`), `citations`, `token`, `done` (model, thinking time, clock time) and `error`. Closing the request stops the answer (R3.6).
   - `GET /api/chat/history` returns the conversation; `DELETE /api/chat/history` clears it, returning what was cleared so **Undo** can put it back with `PUT /api/chat/history`.
   - All of them need the session, Host and Origin checks of every API route. The client reads the stream with `fetch`, which the Content-Security-Policy already allows (`connect-src 'self'`).
2. **The call queue:** answers go through the queue the summaries use, at interactive priority, so pre-filling can't hold them up. They are never shared between requests or cached.
3. **The model:** `model:` in `agent.config.yaml` applies, as for summaries. The chat is built on LangChain.js (decided; the Vercel AI SDK isn't used), in `agent`: the call streams with the chat model's `stream()` and stops on an `AbortSignal`. LangGraph, which comes with `langchain`, may hold the steps (search, then answer) if the plan finds it useful; a plain sequence is enough for this step.
4. **Configuration:** a new `chat:` block in `agent.config.yaml`, read and merged as `summaries:` is (Data Architecture §4.2):

   ```yaml
   chat:
     units: 8              # retrieved units per question
     contextTokens: 12000  # their budget
     historyTurns: 10      # earlier turns sent with a question
     historyTokens: 8000   # their budget
   ```

5. **Settings dialog:** a **Chat** tab next to **Model** and **Summarization**, with the same **Personal** / **Shared** choice (Client Requirements §10).

<a id="WORK-00432" data-uid="w0fklt1p6dhh"></a>
### R8. Tests

1. **Unit:**
   - **The answer pipeline:** every allowed construct; every disallowed one (raw HTML, images, `javascript:` and other model-written links, headings); markers with and without a citation; half-finished Markdown.
   - **The search index:** units, sectioned and not; ranking and the open document's boost; questions holding FTS5 syntax; re-indexing a changed file; a damaged database.
   - **History:** limits, repainting data, a damaged file.
2. **Agent and server:** a fake model that streams an answer with markers (LangChain's `FakeListChatModel` streams its responses) in `agent`, and a stub in `server`; stopping, errors before and during the answer.
3. **Components:** the pane (toggle, width, disabled without a model), the input (Enter, Shift+Enter, IME, blank, saving first), the answer box (streaming, stop, retry, copy), clearing with Undo.
4. **End to end:** `e2e/fake-model.ts` answers `stream: true` requests with OpenAI-style chunks. A test asks a question on a fixture, sees the streamed answer with a working citation, clears, and reloads.
5. **No real model** is ever called, as for summaries.

<a id="WORK-00433" data-uid="dzpz8c4nwqon"></a>
## 4. Out of Scope

- Editing specs from the chat, or proposing changes to them.
- Several conversations, naming or sharing them.
- Search by meaning (embeddings) or through summaries; a model-written search query.
- Answers about code or other files that aren't Markdown.
- Highlighting of code blocks in answers.
- A keyboard shortcut to open the chat pane.

<a id="WORK-00434" data-uid="qb9bdtq44s2b"></a>
## 5. Specifications to Update

- **[Information Architecture](/specifications/info-architecture):** the third pane in the layout, its region in the table, `chat-history.yaml` and `search.db` in the folder diagram.
- **[Client Requirements](/specifications/client-requirements):** the header (§2), a new chat section (R1–R3, R5, R6), the Chat tab in Settings (§10).
- **[Server Requirements](/specifications/server-requirements):** the chat routes, the search index, the history file.
- **[Data Architecture](/specifications/data-architecture):** the new UI state fields (§3), `chat:` in the agent configuration (§4.2), the search index and the history file (new sections), and the answer pipeline next to the preview pipeline (§1).
- **[Technical Architecture](/specifications/technical-architecture):** chat among the agent features (§6), with LangChain's streaming, and streaming in routing (§5.1).
- **[Security](/specifications/security):** §9: what chat sends, saved text only, nothing sent to build the index, the rules for rendering answers and citations, and the history file's contents (excerpts of the specs) kept out of Git.
- **`CLAUDE.md`:** the new modules and files.

<a id="WORK-00435" data-uid="chy6ozz3q0on"></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Full-text search misses questions phrased in other words than the specs | Weak or unsupported answers | The open document is always included; the prompt asks the model to say when the sources don't answer the question; search by meaning can follow |
| Prompt injection through a spec | The answer says what the spec's author wants, or tries to link elsewhere | Answers are limited Markdown with no links but checked citations (R3.5, R5.3); the answer is labeled as AI output |
| Free-tier rate limits (about 40 requests a minute) | Errors while pre-filling also runs | Interactive priority in the queue; **Retry**; pre-filling pauses after a rate limit |
| Long answers on a 31B model | Waiting | Streaming, and a visible **Stop** |
| A third pane on a small screen | A cramped file pane | The 30% minimum (R1.4); the pane can be closed |
| The history holds excerpts of the specs | Shared by accident | It lives in `.specquer/user/`, ignored by Git |

<a id="WORK-00436" data-uid="a0zp6uyh8g95"></a>
## 7. Open Questions

None. All were decided while reviewing the requirements.
