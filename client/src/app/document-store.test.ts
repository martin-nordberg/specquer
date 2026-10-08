import { describe, expect, mock, test } from "bun:test";
import type { Api, SaveOutcome } from "@/lib/api";
import { DocumentStore } from "./document-store";

function fakeApi(files: Record<string, string>) {
  const versions: Record<string, number> = {};
  const version = (path: string) => String(versions[path] ?? 0);
  const saveFile = mock(async (path: string, text: string, baseVersion: string): Promise<SaveOutcome> => {
    if (baseVersion !== version(path)) return { kind: "conflict", version: version(path) };
    files[path] = text;
    versions[path] = (versions[path] ?? 0) + 1;
    return { kind: "saved", version: version(path) };
  });
  const api = {
    readFile: async (path: string) => ({ path, text: files[path]!, version: version(path) }),
    saveFile,
  } as unknown as Api;
  /** Simulates another program changing a file. */
  const external = (path: string, text: string) => {
    files[path] = text;
    versions[path] = (versions[path] ?? 0) + 1;
  };
  return { api, saveFile, files, external };
}

describe("DocumentStore", () => {
  test("splits front matter and body, with LF line endings for the editors", async () => {
    const { api } = fakeApi({ "a.md": "---\r\ntitle: A\r\n---\r\n# A\r\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    expect(store.get().document).toMatchObject({ frontmatter: "title: A", body: "# A\n", openedWithFrontmatter: true });
  });

  test("doesn't save a file that wasn't changed", async () => {
    const { api, saveFile } = fakeApi({ "a.md": "# A\r\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    expect(await store.save()).toBe("clean");
    store.setBody("# A\n");
    expect(await store.save()).toBe("clean");
    expect(saveFile).not.toHaveBeenCalled();
  });

  test("saves with the file's own line endings", async () => {
    const { api, files } = fakeApi({ "a.md": "---\r\nx: 1\r\n---\r\n# A\r\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("# A\nmore\n");
    expect(store.get().status).toBe("unsaved");
    expect(await store.save()).toBe("saved");
    expect(files["a.md"]).toBe("---\r\nx: 1\r\n---\r\n# A\r\nmore\r\n");
    expect(store.get().status).toBe("saved");
  });

  test("adding and clearing front matter", async () => {
    const { api, files } = fakeApi({ "a.md": "# A\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setFrontmatter("title: A");
    await store.save();
    expect(files["a.md"]).toBe("---\ntitle: A\n---\n# A\n");
    store.setFrontmatter("");
    await store.save();
    expect(files["a.md"]).toBe("# A\n");
  });

  test("a change on disk causes a conflict instead of a save", async () => {
    const { api, files, external } = fakeApi({ "a.md": "# A\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("# Mine\n");
    external("a.md", "# Theirs\n");
    expect(await store.save()).toBe("conflict");
    expect(store.get().conflict).not.toBeNull();
    expect(files["a.md"]).toBe("# Theirs\n");
    // No further saves until the conflict is resolved
    expect(await store.save()).toBe("conflict");
    expect(await store.keepMine()).toBe("saved");
    expect(files["a.md"]).toBe("# Mine\n");
    expect(store.get().conflict).toBeNull();
  });

  test("reloading their version replaces the editors' content", async () => {
    const { api, external } = fakeApi({ "a.md": "# A\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    const revision = store.get().document!.revision;
    store.setBody("# Mine\n");
    external("a.md", "# Theirs\n");
    await store.save();
    await store.reloadTheirs();
    expect(store.get()).toMatchObject({ conflict: null, status: "saved", document: { body: "# Theirs\n" } });
    expect(store.get().document!.revision).toBeGreaterThan(revision);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  test("a failed save is reported and can be retried", async () => {
    const { api } = fakeApi({ "a.md": "# A\n" });
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("x");
    (api as { saveFile: unknown }).saveFile = async () => {
      throw new Error("offline");
    };
    expect(await store.save()).toBe("error");
    expect(store.get()).toMatchObject({ status: "error", error: "offline" });
    expect(store.hasUnsavedChanges).toBe(true);
  });
});

describe("anchors added on save", () => {
  test("are applied to the body, through typing during the save, and aren't unsaved changes", async () => {
    const files: Record<string, string> = { "a.md": "---\nx: 1\n---\n# A\n" };
    let release: () => void = () => {};
    const api = {
      readFile: async (path: string) => ({ path, text: files[path]!, version: "1" }),
      saveFile: async (path: string, text: string): Promise<SaveOutcome> => {
        await new Promise<void>((resolve) => (release = resolve));
        const insert = '<a id="RQ-00001"></a>\n\n';
        files[path] = text.replace("---\n# A", `---\n${insert}# A`);
        return { kind: "saved", version: "2", edits: [{ from: 0, to: 0, insert }] };
      },
    } as unknown as Api;
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("# A\ntext\n");
    const saving = store.save();
    store.setBody("# A\ntext typed meanwhile\n");
    release();
    expect(await saving).toBe("saved");
    const document = store.get().document!;
    expect(document.body).toBe('<a id="RQ-00001"></a>\n\n# A\ntext typed meanwhile\n');
    expect(document.externalEdits).toBe(1);
    expect(store.get().status).toBe("unsaved");
    // Without the extra typing, nothing is left to save
    store.setBody('<a id="RQ-00001"></a>\n\n# A\ntext\n');
    expect(await store.save()).toBe("clean");
  });

  test("keeps a save's notices until dismissed", async () => {
    const { api } = fakeApi({ "a.md": "# A\n" });
    const notices = [{ kind: "restored" as const, id: "REQ-00099", newId: "REQ-00002", title: "A" }];
    (api as { saveFile: unknown }).saveFile = async () => ({ kind: "saved", version: "1", notices });
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("# A\nmore\n");
    await store.save();
    expect(store.get().notices).toEqual(notices);
    expect(store.get().version).toBe("1");
    store.dismissNotices();
    expect(store.get().notices).toEqual([]);
  });

  test("renumbering saves first, then applies the server's edits to the body on disk", async () => {
    const { api, files } = fakeApi({ "a.md": "---\nx: 1\n---\n# A\n\n<a id=\"REQ-00002\"></a>\n# B\n" });
    const renumberSection = mock(async (path: string, id: string, uid: string | null, baseVersion: string): Promise<SaveOutcome> => {
      expect([path, id, uid, baseVersion]).toEqual(["a.md", "REQ-00002", null, "1"]);
      const from = files["a.md"]!.indexOf("REQ-00002") - "---\nx: 1\n---\n".length;
      files["a.md"] = files["a.md"]!.replace("REQ-00002", "REQ-00007");
      return {
        kind: "saved",
        version: "2",
        edits: [{ from, to: from + 9, insert: "REQ-00007" }],
        notices: [{ kind: "renumbered", reason: "duplicate", id: "REQ-00002", newId: "REQ-00007", title: "B" }],
      };
    });
    (api as { renumberSection: unknown }).renumberSection = renumberSection;
    const store = new DocumentStore(api);
    await store.open("a.md");
    store.setBody("# A changed\n\n<a id=\"REQ-00002\"></a>\n# B\n");
    expect(await store.renumber("REQ-00002", null)).toBe("saved");
    expect(store.get().document?.body).toBe("# A changed\n\n<a id=\"REQ-00007\"></a>\n# B\n");
    expect(store.get().status).toBe("saved");
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.text()).toBe(files["a.md"]!);
    expect(store.get().notices.map((n) => n.kind)).toEqual(["renumbered"]);
  });
});
