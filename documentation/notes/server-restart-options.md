<a id="NOTE-00078" data-uid="v0ebgzh2azbo"></a>

<a id="NOTE-00079" data-uid="g48jldurqcdl"></a>
# A Stopped or Restarted Server

_Notes from October 2026, after Step 009._

**Summary:** when the server goes away under an open tab, the client keeps the edits in memory and shows "Save failed", and autosave retries every 60 seconds. But it doesn't say why, it can't get back in after a restart, and closing the tab after a failed save loses the edits silently. The proposal is to do three things together: say what happened, never lose edits silently, and keep the session token across restarts, so a restart on the same port needs no action from the user. Local drafts in browser storage can wait. This answers one of the behaviors in [Specification Gaps](/notes/specification-gaps).

<a id="NOTE-00080" data-uid="pp2rfvelmvrr"></a>
## What Happens Today

| Case | What the open tab gets | Can the tab recover? |
|---|---|---|
| Server stopped (Ctrl+C, a crash, the laptop asleep) | Network errors (`fetch` rejects) | Yes, once a server is back on the same port with the same token |
| Server restarted | `401` on every request: a new process has a new token ([Security](/specifications/security) §3), so the tab's cookie no longer works | No; the user has to open the newly printed URL |
| Restarted on another port (4870 was taken) | Network errors from then on: the tab's origin is gone | No; its edits can only be rescued by copying them out |

What the client does now:

- A failed save sets the status to "Save failed" (`DocumentStore.write` in `client/src/app/document-store.ts`). The edits stay in memory, and the 60-second autosave tries again.
- `client/src/lib/api.ts` turns every failure into an `ApiRequestError` with its status. Nothing tells a network error from a `401`.
- There is no `beforeunload` guard.

<a id="NOTE-00081" data-uid="slru63zluybw"></a>
## Options

<a id="NOTE-00082" data-uid="u5diqazr7g52"></a>
### 1. Say What Happened

- Tell "Specquer isn't running" (a network error) apart from "Specquer was restarted; this tab's session has ended" (`401`).
- Show it in a banner, not only in the save status.
- The message suggests running `specquer` again. Since Step 009 that opens the running instance, or starts one and opens it.
- Cost: low. Classify the errors in `lib/api.ts` and add a banner in `App.tsx`.

<a id="NOTE-00083" data-uid="jy0z7e6s4wyd"></a>
### 2. Never Lose Edits Silently

- **Warn before closing:** a `beforeunload` warning while there are unsaved edits. Without it, closing the tab after a failed save discards them, which is the real risk today.
- **Copy my changes:** a button in the banner. It's the only rescue that also works after a port change; the clipboard is already used by the section badges.
- **Retry sooner:** while the server is unreachable, retry the save on a short backoff (2 s, 4 s, … up to 30 s) instead of every 60 seconds. The `baseVersion` check still keeps a save from overwriting a change made on disk meanwhile.
- Cost: low.

<a id="NOTE-00084" data-uid="cbkdsbs4vjfw"></a>
### 3. Keep the Session Across Restarts

- The server keeps its token in `.specquer/user/` (mode `0600`, like `instance.json`) and reuses it at every start. A restart on the same port then behaves like a stopped server: the cookie still works, and the tab carries on by itself.
- This also keeps the session through full restarts of `bun run dev`.
- **Cost:** the token lives on disk indefinitely, not only while Specquer runs. That is acceptable because the server listens on loopback only, the file is the owner's only and ignored by Git, and whatever can read it can already edit the specs.
- **Rotating it:** a `--new-session` option, or deleting the file.
- **Specifications:** Security §3 changes.

<a id="NOTE-00085" data-uid="f0pgm333dtn8"></a>
### 4. Local Drafts

- Unsaved edits are kept in `localStorage` or IndexedDB, keyed by root, path and base version, and offered back when the file is next opened.
- It is the most robust option, and it also covers a browser crash.
- **Limitation:** browser storage belongs to the origin, so after a port change the new tab can't see the old drafts.
- **Cost:** restoring needs a merge-or-discard flow next to the conflict dialog. That is real UI work for a case that options 2 and 3 mostly cover.

<a id="NOTE-00086" data-uid="i7vqj22jvfqr"></a>
### 5. Reconnect Without a Stored Token

Not possible by design: the only proof a tab holds is the old token, and accepting it after a restart amounts to option 3. A future desktop shell, which would start the server itself, could pass the token in directly.

<a id="NOTE-00087" data-uid="v3vghy6hu9qg"></a>
## Recommendation

Do options 1, 2 and 3 together, as one step:

- Option 1 makes failures understandable.
- Option 2 removes silent loss of edits.
- Option 3 makes the common case, a restart on the same port, need no action at all.

Leave option 4 for later, unless browser crashes turn out to matter.
