import { useCallback, useEffect, useId, useState } from "react";
import type { FolderSettings, TreeFolder } from "@specquer/shared/api";
import { isPrefix } from "@specquer/shared/sections";
import type { FolderSetting } from "@specquer/shared/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Api } from "@/lib/api";

export interface FolderSettingsDialogProps {
  /** The folder, or `null` when the dialog is closed. */
  folder: TreeFolder | null;
  onClose: () => void;
  api: Pick<Api, "folderSettings" | "saveFolderSettings">;
  /** Opens **Add section anchors** for the folder (this dialog closes first). */
  onAddAnchors: (folder: TreeFolder) => void;
}

const PREFIX_FILE = ".specquer/shared/section-prefixes.config.yaml";

type Choice = FolderSetting["kind"];

/** Whether a folder is sectioned with these settings. */
function isSectioned(settings: FolderSettings): boolean {
  if (settings.own.kind === "prefix") return true;
  return settings.own.kind === "inherit" && settings.inherited !== null && settings.inherited.prefix !== null;
}

const folderName = (path: string) => (path === "" ? "the root folder" : path);

/** What a folder without an entry of its own follows. */
function inheritedText(settings: FolderSettings): string {
  const inherited = settings.inherited;
  if (inherited === null) return "not sectioned (no folder above it has an entry)";
  const from = inherited.from === "" ? "the root folder" : inherited.from;
  return inherited.prefix === null ? `from ${from}: not sectioned` : `from ${from}: sectioned, prefix ${inherited.prefix}`;
}

/**
 * A folder's settings: whether its Markdown files are sectioned (inherited from the folder above,
 * yes with a prefix, or no) and **Add section anchors**. Saving writes the folder's entry in the
 * prefix configuration.
 */
export function FolderSettingsDialog({ folder, onClose, api, onAddAnchors }: FolderSettingsDialogProps) {
  const id = useId();
  const [settings, setSettings] = useState<FolderSettings | null>(null);
  const [choice, setChoice] = useState<Choice>("inherit");
  const [prefix, setPrefix] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** After a save that changed whether the folder is sectioned. */
  const [after, setAfter] = useState<"sectioned" | "unsectioned" | null>(null);

  const load = useCallback(
    async (path: string) => {
      const loaded = await api.folderSettings(path);
      setSettings(loaded);
      setChoice(loaded.own.kind);
      setPrefix(loaded.own.kind === "prefix" ? loaded.own.prefix : (loaded.inherited?.prefix ?? ""));
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

  const trimmed = prefix.trim();
  const prefixError = choice === "prefix" && !isPrefix(trimmed) ? "An upper-case letter followed by 1 to 4 upper-case letters or digits, such as SPEC." : undefined;
  const setting: FolderSetting = choice === "prefix" ? { kind: "prefix", prefix: trimmed } : { kind: choice };
  const changed =
    settings !== null && (settings.own.kind !== setting.kind || (setting.kind === "prefix" && settings.own.kind === "prefix" && settings.own.prefix !== setting.prefix));

  const save = async () => {
    if (settings === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const outcome = await api.saveFolderSettings(folder.path, setting, settings.version);
      if (outcome.kind === "conflict") {
        await load(folder.path);
        setMessage(`${PREFIX_FILE} changed on disk, so the settings were reloaded. Make your change again.`);
      } else if (outcome.kind === "invalid") setMessage(outcome.message);
      else if (outcome.sectioned !== isSectioned(settings)) {
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
            <span className="font-mono">{PREFIX_FILE}</span>.
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
              <div className="grid gap-2">
                <p id={`${id}-sectioned`} className="font-medium">
                  Sectioned
                </p>
                <p className="text-xs text-muted-foreground">Specquer adds section anchors, which give sections permanent IDs, to the Markdown files of a sectioned folder.</p>
                <RadioGroup aria-labelledby={`${id}-sectioned`} value={choice} onValueChange={(value) => setChoice(value as Choice)}>
                  <Label htmlFor={`${id}-inherit`} className="font-normal">
                    <RadioGroupItem id={`${id}-inherit`} value="inherit" /> Inherited: {inheritedText(settings)}
                  </Label>
                  <Label htmlFor={`${id}-prefix`} className="font-normal">
                    <RadioGroupItem id={`${id}-prefix`} value="prefix" /> Yes
                  </Label>
                  <Label htmlFor={`${id}-off`} className="font-normal">
                    <RadioGroupItem id={`${id}-off`} value="off" /> No
                  </Label>
                </RadioGroup>
              </div>
              {choice === "prefix" && (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-prefix-input`}>Prefix</Label>
                  <Input
                    id={`${id}-prefix-input`}
                    className="w-32 font-mono"
                    value={prefix}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={prefixError !== undefined}
                    aria-describedby={`${id}-prefix-help`}
                    onChange={(event) => setPrefix(event.target.value.toUpperCase())}
                  />
                  <p id={`${id}-prefix-help`} className={prefixError === undefined ? "text-xs text-muted-foreground" : "text-xs text-error-text"}>
                    {prefixError ?? "New sections in the folder get IDs with this prefix; existing sections keep theirs."}
                  </p>
                </div>
              )}
              {settings.fileKeys.length > 0 && (
                <div className="grid gap-1">
                  <p>Files inside with settings of their own (edited in the YAML file):</p>
                  <ul aria-label="Files with their own settings" className="rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
                    {settings.fileKeys.map((key) => (
                      <li key={key.path}>
                        {key.path}: {key.prefix ?? "not sectioned"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!isSectioned(settings)} onClick={addAnchors}>
                  Add section anchors…
                </Button>
                <span className="text-xs text-muted-foreground">
                  {isSectioned(settings) ? "Add missing anchors to the folder's files." : "For sectioned folders."}
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
                disabled={!changed || prefixError !== undefined || saving || settings?.error !== undefined}
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
