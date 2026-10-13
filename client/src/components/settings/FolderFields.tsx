import type { FolderSettings, InheritedValue } from "@specquer/shared/api";
import { isPrefix } from "@specquer/shared/sections";
import { FOLDER_TYPES, type FolderSetting, type FolderType, isSectionedType } from "@specquer/shared/settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** What a folder inherits, key by key. */
export type Inherited = FolderSettings["inherited"];

export const FOLDER_TYPE_LABELS: Record<FolderType, { label: string; description: string }> = {
  BASELINE: { label: "Baseline", description: "The current or intended state of the whole system." },
  CHANGE: { label: "Change", description: "The work for a given task or feature." },
  AUXILIARY: { label: "Auxiliary", description: "Sectioned specs that aren't updated from change specs." },
  NONSECTIONED: { label: "Non-sectioned", description: "Markdown that Specquer doesn't section." },
};

export const PREFIX_HELP = "An upper-case letter followed by 1 to 4 upper-case letters or digits, such as SPEC.";

const folderName = (path: string) => (path === "" ? "the root folder" : path);

/** What a folder's settings come to: its own values, else the inherited ones. */
export function effectiveSettings(settings: Pick<FolderSettings, "path" | "own" | "inherited">): Inherited {
  const { own, inherited, path } = settings;
  return {
    folderType: own.folderType === "inherit" ? inherited.folderType : { value: own.folderType, from: path },
    defaultPrefix: own.defaultPrefix === "inherit" ? inherited.defaultPrefix : { value: own.defaultPrefix, from: path },
  };
}

/** Whether settings make a folder sectioned: a sectioned type and a prefix. */
export function isSectioned(effective: Inherited): boolean {
  return isSectionedType(effective.folderType.value) && effective.defaultPrefix.value !== null;
}

function inheritedText<T extends string>(value: InheritedValue<T>, describe: (value: T) => string, none: string): string {
  return value.value === null || value.from === null ? none : `from ${folderName(value.from)}: ${describe(value.value)}`;
}

/** The type and prefix as entered, in the dialogs' fields. */
export interface FolderFieldValues {
  folderType: FolderType | "inherit";
  /** The prefix typed; empty, or the inherited one, means inherited. */
  prefix: string;
}

/** The fields for a folder's settings, from its own settings. */
export function fieldValues(settings: Pick<FolderSettings, "own" | "inherited">): FolderFieldValues {
  return {
    folderType: settings.own.folderType,
    prefix: settings.own.defaultPrefix === "inherit" ? (settings.inherited.defaultPrefix.value ?? "") : settings.own.defaultPrefix,
  };
}

/**
 * The setting to save for what was entered, with a problem with the prefix if any. A prefix
 * equal to the inherited one is inherited, so a file holds only values that differ (R1.4).
 */
export function settingFor(values: FolderFieldValues, inherited: Inherited): { setting: FolderSetting; problem?: string } {
  const prefix = values.prefix.trim();
  const type = values.folderType === "inherit" ? inherited.folderType.value : values.folderType;
  const inheritPrefix = prefix === "" || prefix === inherited.defaultPrefix.value;
  const setting: FolderSetting = { folderType: values.folderType, defaultPrefix: inheritPrefix ? "inherit" : prefix };
  // A non-sectioned folder keeps a valid prefix for the folders in it; the field is hidden
  if (!isSectionedType(type)) return { setting: isPrefix(prefix) || inheritPrefix ? setting : { ...setting, defaultPrefix: "inherit" } };
  if (prefix === "" && inherited.defaultPrefix.value === null) return { setting, problem: `A sectioned folder needs a prefix. ${PREFIX_HELP}` };
  if (!inheritPrefix && !isPrefix(prefix)) return { setting, problem: PREFIX_HELP };
  return { setting };
}

export interface FolderFieldsProps {
  /** A unique id prefix for the fields. */
  id: string;
  values: FolderFieldValues;
  inherited: Inherited;
  problem?: string;
  onChange: (values: FolderFieldValues) => void;
}

/** The folder type (inherited or one of the four) and, for a sectioned type, the default prefix. */
export function FolderFields({ id, values, inherited, problem, onChange }: FolderFieldsProps) {
  const type = values.folderType === "inherit" ? inherited.folderType.value : values.folderType;
  const typeText = (value: FolderType) => FOLDER_TYPE_LABELS[value].label;
  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-2">
        <p id={`${id}-type`} className="font-medium">
          Folder type
        </p>
        <RadioGroup aria-labelledby={`${id}-type`} value={values.folderType} onValueChange={(value) => onChange({ ...values, folderType: value as FolderFieldValues["folderType"] })}>
          <Label htmlFor={`${id}-inherit`} className="font-normal">
            <RadioGroupItem id={`${id}-inherit`} value="inherit" /> Inherited: {inheritedText(inherited.folderType, typeText, "non-sectioned (no folder above sets a type)")}
          </Label>
          {FOLDER_TYPES.map((folderType) => (
            <Label key={folderType} htmlFor={`${id}-${folderType}`} className="items-start font-normal">
              <RadioGroupItem id={`${id}-${folderType}`} value={folderType} className="mt-0.5" />
              <span>
                {FOLDER_TYPE_LABELS[folderType].label}
                <span className="block text-xs text-muted-foreground">{FOLDER_TYPE_LABELS[folderType].description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>
      {isSectionedType(type) && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-prefix`}>Default prefix</Label>
          <Input
            id={`${id}-prefix`}
            className="w-32 font-mono"
            value={values.prefix}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem !== undefined}
            aria-describedby={`${id}-prefix-help`}
            onChange={(event) => onChange({ ...values, prefix: event.target.value.toUpperCase() })}
          />
          <p id={`${id}-prefix-help`} className={problem === undefined ? "text-xs text-muted-foreground" : "text-xs text-error-text"}>
            {problem ??
              `New files in the folder get IDs with this prefix; existing sections keep theirs. ${inheritedText(inherited.defaultPrefix, (value) => value, "No folder above sets one.").replace(/^from/, "Inherited from")}`}
          </p>
        </div>
      )}
    </div>
  );
}
