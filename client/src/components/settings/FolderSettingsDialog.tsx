import { useCallback, useEffect, useId, useState } from "react";
import type { FolderSettings, TreeFolder } from "@specquer/shared/api";
import { FOLDER_CONFIG_FILE } from "@specquer/shared/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Api } from "@/lib/api";
import { FolderFields, type FolderFieldValues, effectiveSettings, fieldValues, isSectioned, settingFor } from "./FolderFields";

export interface FolderSettingsDialogProps {
  /** The folder, or `null` when the dialog is closed. */
  folder: TreeFolder | null;
  onClose: () => void;
  api: Pick<Api, "folderSettings" | "saveFolderSettings">;
  /** Opens **Add section anchors** for the folder (this dialog closes first). */
  onAddAnchors: (folder: TreeFolder) => void;
}

const folderName = (path: string) => (path === "" ? "the root folder" : path);
const configFile = (path: string) => (path === "" ? FOLDER_CONFIG_FILE : `${path}/${FOLDER_CONFIG_FILE}`);

/**
 * A folder's settings: its type (inherited from the folder above, or Baseline, Change, Auxiliary
 * or Non-sectioned), its default prefix, and **Add section anchors**. Saving writes the folder's
 * own `.specquer-config.yaml`, holding only the values that differ from the inherited ones.
 */
export function FolderSettingsDialog({ folder, onClose, api, onAddAnchors }: FolderSettingsDialogProps) {
  const id = useId();
  const [settings, setSettings] = useState<FolderSettings | null>(null);
  const [values, setValues] = useState<FolderFieldValues>({ folderType: "inherit", prefix: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** After a save that changed whether the folder is sectioned. */
  const [after, setAfter] = useState<"sectioned" | "unsectioned" | null>(null);

  const load = useCallback(
    async (path: string) => {
      const loaded = await api.folderSettings(path);
      setSettings(loaded);
      setValues(fieldValues(loaded));
    },
    [api],
  );

  useEffect(() => {
    setSettings(null);
    setMessage(null);
    setAfter(null);
    if (folder === null) return;
    load(folder.path).catch((err: Error) => setMessage(err.message));
  }, [folder, load]);

  if (folder === null) return <Dialog open={false} />;

  const { setting, problem } = settings === null ? { setting: undefined, problem: undefined } : settingFor(values, settings.inherited);
  const changed = settings !== null && setting !== undefined && (settings.own.folderType !== setting.folderType || settings.own.defaultPrefix !== setting.defaultPrefix);
  const sectioned = settings !== null && isSectioned(effectiveSettings(settings));

  const save = async () => {
    if (settings === null || setting === undefined) return;
    setSaving(true);
    setMessage(null);
    try {
      const outcome = await api.saveFolderSettings(folder.path, setting, settings.version);
      if (outcome.kind === "conflict") {
        await load(folder.path);
        setMessage(`${configFile(folder.path)} changed on disk, so the settings were reloaded. Make your change again.`);
      } else if (outcome.kind === "invalid") setMessage(outcome.message);
      else if (outcome.sectioned !== sectioned) {
        await load(folder.path);
        setAfter(outcome.sectioned ? "sectioned" : "unsectioned");
      } else onClose();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addAnchors = () => {
    onClose();
    onAddAnchors(folder);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Folder settings</DialogTitle>
          <DialogDescription>
            Settings for <span className="font-mono">{folderName(folder.path)}</span> and the folders in it, saved in{" "}
            <span className="font-mono">{configFile(folder.path)}</span>.
          </DialogDescription>
        </DialogHeader>
        {after !== null ? (
          <div role="status" className="grid gap-2 text-sm">
            {after === "sectioned" ? (
              <p>The folder is sectioned now: Specquer adds section anchors to its files when they are saved. Add them to every file now?</p>
            ) : (
              <p>
                The folder isn't sectioned any more. The anchors stay in its files, and its sections keep their IDs if it is sectioned
                again.
              </p>
            )}
          </div>
        ) : (
          settings !== null && (
            <div className="grid gap-4 text-sm">
              {settings.error !== undefined && (
                <p role="alert" className="rounded-md border border-warning bg-warning/10 px-3 py-2">
                  {settings.error}. Fix the file by hand before saving.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Specquer adds section anchors, which give sections permanent IDs, to the Markdown files of a sectioned folder. New sections
                take their parent section's prefix; a file's root section takes the folder's.
              </p>
              <FolderFields id={id} values={values} inherited={settings.inherited} {...(problem === undefined ? {} : { problem })} onChange={setValues} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={!sectioned} onClick={addAnchors}>
                  Add section anchors…
                </Button>
                <span className="text-xs text-muted-foreground">
                  {sectioned ? "Add missing anchors to the folder's files." : "For sectioned folders."}
                </span>
              </div>
            </div>
          )
        )}
        {message !== null && (
          <p role="alert" className="text-sm text-error-text">
            {message}
          </p>
        )}
        <DialogFooter>
          {after === "sectioned" ? (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button type="button" onClick={addAnchors}>
                Add section anchors…
              </Button>
            </>
          ) : after === "unsectioned" ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!changed || problem !== undefined || saving || settings?.error !== undefined}
                onClick={() => void save()}
              >
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
