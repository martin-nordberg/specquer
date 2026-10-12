import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AgentSettings, ModelTestResult } from "@specquer/shared/api";
import { API_KEY_ENV_PATTERN, type SettingSource, type SettingsScope, type SummarySettingKey } from "@specquer/shared/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Api } from "@/lib/api";
import {
  type ModelDraft,
  type ModelField,
  type ModelValues,
  type SummaryDraft,
  buildUpdates,
  emptyModelDraft,
  emptySummaryDraft,
  enablesSharedPrefill,
  isModelDirty,
  isSummaryDirty,
  modelConfigOf,
  modelErrors,
  shownModel,
  shownSummary,
  summaryErrors,
} from "./settings-form";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  api: Pick<Api, "agentSettings" | "saveAgentSettings" | "envSet" | "testModel">;
  /** Called after a save, since the summary status may have changed. */
  onSaved: () => void;
}

type Tab = "model" | "summarization";

const FILES: Record<SettingsScope, string> = {
  personal: ".specquer/user/agent.config.yaml",
  shared: ".specquer/shared/agent.config.yaml",
};

const SOURCE_LABELS: Record<SettingSource, string> = { personal: "Personal", shared: "Shared", default: "Default" };

const SOURCE_TITLES: Record<SettingSource, string> = {
  personal: "Set in your personal settings",
  shared: "Set in the shared settings",
  default: "Specquer's default",
};

/** Debounce for checking whether a typed key variable is set. */
const ENV_CHECK_DELAY = 300;

/**
 * The system settings: the agent configuration's model and summaries settings, in tabs. Each
 * tab saves to the personal or the shared file, and shows where each value in effect comes from.
 */
export function SettingsDialog({ open, onClose, api, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("model");
  const [scopes, setScopes] = useState<Record<Tab, SettingsScope>>({ model: "personal", summarization: "personal" });
  const [pendingScope, setPendingScope] = useState<{ tab: Tab; scope: SettingsScope } | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(emptyModelDraft);
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraft>(emptySummaryDraft);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingPrefill, setConfirmingPrefill] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.agentSettings());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
    setModelDraft(emptyModelDraft());
    setSummaryDraft(emptySummaryDraft());
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setSettings(null);
    setTab("model");
    setScopes({ model: "personal", summarization: "personal" });
    setPendingScope(null);
    setMessage(null);
    void load();
  }, [open, load]);

  const dirty: Record<Tab, boolean> = { model: isModelDirty(modelDraft), summarization: isSummaryDirty(summaryDraft) };

  const changeScope = (which: Tab, scope: SettingsScope) => {
    if (scope === scopes[which]) return;
    if (dirty[which]) setPendingScope({ tab: which, scope });
    else setScopes((current) => ({ ...current, [which]: scope }));
  };

  const discardAndSwitch = () => {
    if (pendingScope === null) return;
    if (pendingScope.tab === "model") setModelDraft(emptyModelDraft());
    else setSummaryDraft(emptySummaryDraft());
    setScopes((current) => ({ ...current, [pendingScope.tab]: pendingScope.scope }));
    setPendingScope(null);
  };

  const modelValues = settings === null ? null : modelDraft.values ?? shownModel(settings, scopes.model, modelDraft.reset).value;
  const invalid =
    (modelDraft.values !== null && Object.keys(modelErrors(modelDraft.values)).length > 0) || Object.keys(summaryErrors(summaryDraft)).length > 0;
  const updates = settings === null ? [] : buildUpdates(settings, scopes.model, modelDraft, scopes.summarization, summaryDraft);
  const brokenTarget = settings === null ? undefined : updates.map((update) => settings[update.scope].error).find((error) => error !== undefined);

  const save = async (confirmed: boolean) => {
    if (settings === null || updates.length === 0) return;
    if (!confirmed && enablesSharedPrefill(settings, updates)) {
      setConfirmingPrefill(true);
      return;
    }
    setConfirmingPrefill(false);
    setSaving(true);
    setMessage(null);
    try {
      for (const update of updates) {
        const outcome = await api.saveAgentSettings(update);
        if (outcome.kind === "conflict") {
          await load();
          setMessage({ kind: "error", text: `${FILES[update.scope]} changed on disk, so the values were reloaded. Make your changes again.` });
          onSaved();
          return;
        }
        if (outcome.kind === "invalid") {
          setMessage({ kind: "error", text: outcome.message });
          return;
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>The model and summarization settings. Changes take effect without a restart.</DialogDescription>
        </DialogHeader>
        {loadError !== null && (
          <p role="alert" className="text-sm text-error-text">
            Couldn't load the settings: {loadError}
          </p>
        )}
        {settings !== null && modelValues !== null && (
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList>
              <TabsTrigger value="model">Model</TabsTrigger>
              <TabsTrigger value="summarization">Summarization</TabsTrigger>
            </TabsList>
            {(["model", "summarization"] as const).map((which) => (
              <TabsContent key={which} value={which} className="grid gap-4">
                <ScopeSwitch scope={scopes[which]} onChange={(scope) => changeScope(which, scope)} />
                {pendingScope?.tab === which && (
                  <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
                    <span className="flex-1">Discard this tab's unsaved changes?</span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setPendingScope(null)}>
                      Keep editing
                    </Button>
                    <Button type="button" size="sm" onClick={discardAndSwitch}>
                      Discard
                    </Button>
                  </div>
                )}
                <FileProblems settings={settings} scope={scopes[which]} />
                {which === "model" ? (
                  <ModelTab
                    api={api}
                    settings={settings}
                    scope={scopes.model}
                    draft={modelDraft}
                    values={modelValues}
                    onChange={setModelDraft}
                  />
                ) : (
                  <SummarizationTab settings={settings} scope={scopes.summarization} draft={summaryDraft} onChange={setSummaryDraft} />
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
        {message !== null && (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-error-text" : "text-sm"}>
            {message.text}
          </p>
        )}
        {brokenTarget !== undefined && (
          <p role="alert" className="text-sm text-error-text">
            Can't save: {brokenTarget}. Fix the file by hand first.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={updates.length === 0 || invalid || saving || brokenTarget !== undefined} onClick={() => void save(false)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
      <Dialog open={confirmingPrefill} onOpenChange={(next) => !next && setConfirmingPrefill(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Pre-fill summaries for everyone?</DialogTitle>
            <DialogDescription>
              The shared settings are committed, so pre-filling will be on for everyone who pulls this change: their Specquer will send
              every section of every Markdown file to the model provider in the background.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmingPrefill(false)}>
              Back
            </Button>
            <Button type="button" onClick={() => void save(true)}>
              Switch on for everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function ScopeSwitch({ scope, onChange }: { scope: SettingsScope; onChange: (scope: SettingsScope) => void }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <RadioGroup aria-label="Save to" value={scope} onValueChange={(value) => onChange(value as SettingsScope)} className="flex gap-4">
        <Label htmlFor={`${id}-personal`} className="font-normal">
          <RadioGroupItem id={`${id}-personal`} value="personal" /> Personal
        </Label>
        <Label htmlFor={`${id}-shared`} className="font-normal">
          <RadioGroupItem id={`${id}-shared`} value="shared" /> Shared
        </Label>
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {scope === "personal" ? (
          <>
            For you only, in <span className="font-mono">{FILES.personal}</span>, which overrides the shared settings.
          </>
        ) : (
          <>
            For everyone using the repository, in <span className="font-mono">{FILES.shared}</span>, which is committed.
          </>
        )}
      </p>
    </div>
  );
}

/** The file's YAML error, or the values in it ignored as invalid. */
function FileProblems({ settings, scope }: { settings: AgentSettings; scope: SettingsScope }) {
  const file = settings[scope];
  if (file.error === undefined && file.warnings.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
      {file.error !== undefined ? (
        <p>{file.error}. Fix the file by hand before saving to it.</p>
      ) : (
        <>
          <p>Values ignored as invalid:</p>
          <ul className="list-disc pl-5 font-mono text-xs">
            {file.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SourceBadge({ source, overridden }: { source: SettingSource; overridden?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
      <span title={SOURCE_TITLES[source]} className="rounded border px-1.5 py-px">
        {SOURCE_LABELS[source]}
      </span>
      {overridden === true && <span>(overridden by your personal setting)</span>}
    </span>
  );
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" aria-label={label} title={label} onClick={onClick}>
      <RotateCcw /> Reset
    </Button>
  );
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (error === undefined) return null;
  return (
    <p id={id} className="text-xs text-error-text">
      {error}
    </p>
  );
}

const MODEL_FIELDS: Array<{ field: ModelField; label: string; placeholder: string }> = [
  { field: "name", label: "Model ID", placeholder: "google/gemma-4-31b-it" },
  { field: "baseUrl", label: "Base URL", placeholder: "https://integrate.api.nvidia.com/v1" },
  { field: "apiKeyEnv", label: "API key variable", placeholder: "NVIDIA_API_KEY" },
];

type TestState = { kind: "idle" } | { kind: "running"; controller: AbortController } | { kind: "done"; result: ModelTestResult };

function ModelTab({
  api,
  settings,
  scope,
  draft,
  values,
  onChange,
}: {
  api: SettingsDialogProps["api"];
  settings: AgentSettings;
  scope: SettingsScope;
  draft: ModelDraft;
  values: ModelValues;
  onChange: (draft: ModelDraft) => void;
}) {
  const id = useId();
  const shown = shownModel(settings, scope, draft.reset);
  const errors = draft.values === null ? {} : modelErrors(draft.values);
  const [keys, setKeys] = useState<Record<string, boolean>>(settings.keys);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => setKeys((current) => ({ ...settings.keys, ...current })), [settings.keys]);

  // Whether the typed key variable is set, checked once typing pauses
  const keyName = values.apiKeyEnv.trim();
  const keyKnown = keys[keyName] !== undefined;
  useEffect(() => {
    if (keyKnown || !API_KEY_ENV_PATTERN.test(keyName)) return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .envSet(keyName)
        .then((set) => current && setKeys((known) => ({ ...known, [keyName]: set })))
        .catch(() => {});
    }, ENV_CHECK_DELAY);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, keyName, keyKnown]);

  // A test still running when the dialog closes is stopped
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  const edit = (field: ModelField, value: string) => {
    if (test.kind === "done") setTest({ kind: "idle" });
    onChange({ values: { ...values, [field]: value }, reset: false });
  };

  const runTest = async () => {
    const controller = new AbortController();
    running.current = controller;
    setTest({ kind: "running", controller });
    try {
      const result = await api.testModel(modelConfigOf(values), controller.signal);
      setTest({ kind: "done", result });
    } catch (err) {
      if (controller.signal.aborted) setTest({ kind: "idle" });
      else setTest({ kind: "done", result: { ok: false, problem: (err as Error).message } });
    } finally {
      if (running.current === controller) running.current = null;
    }
  };

  const keySet = keys[keyName];
  const testable = Object.keys(modelErrors(values)).length === 0;
  const canReset = scope === "personal" && draft.values === null && !draft.reset && shown.source === "personal";

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Provider</span>
        <span>NVIDIA (OpenAI-compatible API)</span>
        <span className="flex-1" />
        <SourceBadge source={draft.values === null ? shown.source : scope} overridden={shown.overridden} />
        {canReset && <ResetButton label="Reset the model to the shared setting" onClick={() => onChange({ values: null, reset: true })} />}
      </div>
      {MODEL_FIELDS.map(({ field, label, placeholder }) => (
        <div key={field} className="grid gap-1.5">
          <Label htmlFor={`${id}-${field}`}>{label}</Label>
          <Input
            id={`${id}-${field}`}
            value={values[field]}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors[field] !== undefined}
            aria-describedby={errors[field] === undefined ? undefined : `${id}-${field}-error`}
            onChange={(event) => edit(field, event.target.value)}
          />
          <FieldError id={`${id}-${field}-error`} error={errors[field]} />
          {field === "apiKeyEnv" && errors.apiKeyEnv === undefined && keySet !== undefined && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {keySet ? (
                <>
                  <span className="font-mono">{keyName}</span>: found.
                </>
              ) : (
                <>
                  <span className="font-mono">{keyName}</span>: not set. Set it in the environment Specquer starts in (or in{" "}
                  <span className="font-mono">server/.env</span>) and restart Specquer: the server reads its environment only at startup.
                </>
              )}
            </p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">The API key itself is never shown or saved here, only the name of the variable that holds it.</p>
      <p className="text-sm" aria-label="Model status">
        {settings.status.enabled ? `Summaries are on, with ${settings.status.model}.` : `Summaries are off: ${settings.status.problem ?? "no model."}`}
      </p>
      <div className="grid gap-1.5 rounded-md border px-3 py-2">
        <div className="flex items-center gap-2">
          {test.kind === "running" ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => test.controller.abort()}>
              Cancel test
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={!testable} onClick={() => void runTest()}>
              Test
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Sends a short fixed prompt, and the key in <span className="font-mono">{keyName || "…"}</span>, to{" "}
            <span className="font-mono break-all">{values.baseUrl}</span>.
          </span>
        </div>
        {test.kind === "running" && (
          <p role="status" className="text-sm">
            Testing…
          </p>
        )}
        {test.kind === "done" &&
          (test.result.ok ? (
            <p role="status" className="text-sm">
              The model answered in {(test.result.ms / 1000).toFixed(1)} s.
            </p>
          ) : (
            <p role="alert" className="text-sm text-error-text">
              {test.result.problem}
            </p>
          ))}
      </div>
    </div>
  );
}

const NUMBER_FIELDS: Array<{ key: "concurrency" | "tokenBudget"; label: string; help: string }> = [
  { key: "concurrency", label: "Concurrent model calls", help: "How many model calls run at once (1 to 16)." },
  {
    key: "tokenBudget",
    label: "Token budget",
    help: "Sections estimated above this many tokens are summarized from their subsections' summaries (1,000 to 1,000,000).",
  },
];

function SummarizationTab({
  settings,
  scope,
  draft,
  onChange,
}: {
  settings: AgentSettings;
  scope: SettingsScope;
  draft: SummaryDraft;
  onChange: (draft: SummaryDraft) => void;
}) {
  const id = useId();
  const errors = summaryErrors(draft);
  const shown = <K extends SummarySettingKey>(key: K) => shownSummary(settings, scope, key, draft.reset.has(key));
  const sourceOf = (key: SummarySettingKey) => (draft.values[key] !== undefined ? scope : shown(key).source);
  const canReset = (key: SummarySettingKey) => scope === "personal" && draft.values[key] === undefined && !draft.reset.has(key) && shown(key).source === "personal";
  const edit = (key: SummarySettingKey, value: string | boolean) => {
    const reset = new Set(draft.reset);
    reset.delete(key);
    onChange({ values: { ...draft.values, [key]: value }, reset });
  };
  const reset = (key: SummarySettingKey) => onChange({ values: draft.values, reset: new Set([...draft.reset, key]) });

  const prefill = draft.values.prefill ?? shown("prefill").value;
  const switchingOn = draft.values.prefill === true && shown("prefill").value !== true;

  return (
    <div className="grid gap-4">
      {NUMBER_FIELDS.map(({ key, label, help }) => (
        <div key={key} className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor={`${id}-${key}`}>{label}</Label>
            <span className="flex-1" />
            <SourceBadge source={sourceOf(key)} overridden={shown(key).overridden} />
            {canReset(key) && <ResetButton label={`Reset ${label.toLowerCase()} to the shared setting`} onClick={() => reset(key)} />}
          </div>
          <Input
            id={`${id}-${key}`}
            inputMode="numeric"
            value={draft.values[key] ?? String(shown(key).value)}
            aria-invalid={errors[key] !== undefined}
            aria-describedby={`${id}-${key}-help`}
            onChange={(event) => edit(key, event.target.value)}
          />
          <p id={`${id}-${key}-help`} className={errors[key] === undefined ? "text-xs text-muted-foreground" : "text-xs text-error-text"}>
            {errors[key] ?? help}
          </p>
        </div>
      ))}
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Switch id={`${id}-prefill`} checked={prefill} onCheckedChange={(checked) => edit("prefill", checked)} />
          <Label htmlFor={`${id}-prefill`}>Pre-fill summaries in the background</Label>
          <span className="flex-1" />
          <SourceBadge source={sourceOf("prefill")} overridden={shown("prefill").overridden} />
          {canReset("prefill") && <ResetButton label="Reset pre-filling to the shared setting" onClick={() => reset("prefill")} />}
        </div>
        <p className="text-xs text-muted-foreground">Summarizes every section of every Markdown file, so the slider finds its summaries made.</p>
        {switchingOn && (
          <p role="alert" className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
            The server will send every section of every Markdown file to the model provider in the background, whether or not anyone opens
            it, and again after each change. Switch it on only for specs you would send anyway.
            {scope === "shared" && " In the shared settings, this applies to everyone who pulls the change."}
          </p>
        )}
      </div>
    </div>
  );
}
