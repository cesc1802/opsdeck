import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChatProfile, JobSummary, LaunchOptions } from "@/lib/bindings";
import {
  createJob,
  fetchChatConfig,
  fetchProfiles,
  fetchProjects,
  saveProfile,
  validateDir,
  validateLaunchOptions,
} from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { hooksJsonToRows } from "@/features/config/builder-model";
import { cn } from "@/lib/utils";
import { CheckboxRow, Field } from "./form-fields";
import {
  applyPreset,
  defaultLaunchOptions,
  groupFieldErrors,
  listToText,
  matchPresetId,
  PRESET_DESCRIPTION_KEYS,
  textToList,
} from "./launch-presets";
import {
  CUSTOM_CWD,
  matchProjectByCwd,
  projectPickerEntries,
} from "./project-picker";

type ListField =
  | "allowed_tools"
  | "disallowed_tools"
  | "mcp_configs"
  | "plugin_dirs";

interface NewChatFormProps {
  initial?: Partial<LaunchOptions>;
  onCreated: (job: JobSummary) => void;
}

export function NewChatForm({ initial, onCreated }: NewChatFormProps) {
  const [options, setOptions] = useState<LaunchOptions>(() => ({
    ...defaultLaunchOptions(),
    ...initial,
  }));
  const [listText, setListText] = useState<Record<ListField, string>>(() => {
    const merged = { ...defaultLaunchOptions(), ...initial };
    return {
      allowed_tools: listToText(merged.allowed_tools),
      disallowed_tools: listToText(merged.disallowed_tools),
      mcp_configs: listToText(merged.mcp_configs),
      plugin_dirs: listToText(merged.plugin_dirs),
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Result of the latest async directory check, keyed by the path it checked
  // so a stale response for a previous cwd value never shows an error.
  const [cwdCheck, setCwdCheck] = useState<{
    path: string;
    exists: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Sticky "Custom path…" choice: without it, picking custom while cwd still
  // equals a project path would immediately derive back to that project.
  const [customPicked, setCustomPicked] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [loadedProfile, setLoadedProfile] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: queryKeys.chatConfig,
    queryFn: fetchChatConfig,
    staleTime: Infinity,
  });
  const { data: profiles } = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
  });
  // Same key as the sidebar; TanStack dedupes the fetch.
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
  });

  const set = <K extends keyof LaunchOptions>(
    key: K,
    value: LaunchOptions[K],
  ) => setOptions((prev) => ({ ...prev, [key]: value }));

  // Build the options actually submitted: list textareas parsed into arrays.
  const finalOptions = useMemo<LaunchOptions>(
    () => ({
      ...options,
      allowed_tools: textToList(listText.allowed_tools),
      disallowed_tools: textToList(listText.disallowed_tools),
      mcp_configs: textToList(listText.mcp_configs),
      plugin_dirs: textToList(listText.plugin_dirs),
    }),
    [options, listText],
  );

  const activePresetId = useMemo(
    () => (config ? matchPresetId(finalOptions, config.presets) : null),
    [config, finalOptions],
  );

  useEffect(() => {
    const path = options.cwd;
    if (!path.trim()) {
      return;
    }
    let cancelled = false;
    validateDir(path).then((exists) => {
      if (!cancelled) setCwdCheck({ path, exists });
    });
    return () => {
      cancelled = true;
    };
  }, [options.cwd]);

  const cwdError =
    errors.cwd ??
    (cwdCheck && cwdCheck.path === options.cwd && !cwdCheck.exists
      ? t("chat.form.cwdInvalid")
      : undefined);

  // Picker state is derived from options.cwd (single source of truth): a
  // matching project selects its entry; any other non-empty cwd (e.g. a
  // Resume/Fork seed from a subdirectory) falls to "Custom path…"; an empty
  // cwd shows the placeholder.
  const pickerEntries = useMemo(
    () => projectPickerEntries(projects ?? []),
    [projects],
  );
  const matchedProject = useMemo(
    () => matchProjectByCwd(projects ?? [], options.cwd),
    [projects, options.cwd],
  );
  const pickerValue = customPicked
    ? CUSTOM_CWD
    : (matchedProject?.project_id ?? (options.cwd ? CUSTOM_CWD : ""));
  const showCwdInput = pickerValue === CUSTOM_CWD;

  async function launch(candidate: LaunchOptions) {
    setSubmitting(true);
    try {
      const job = await createJob(candidate);
      onCreated(job);
    } catch (error) {
      toast.error(t("chat.form.startFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function applyProfile(profile: ChatProfile) {
    setLoadedProfile(profile.name);
    // Let the loaded cwd derive its own picker entry.
    setCustomPicked(false);
    setOptions(profile.options);
    setListText({
      allowed_tools: listToText(profile.options.allowed_tools),
      disallowed_tools: listToText(profile.options.disallowed_tools),
      mcp_configs: listToText(profile.options.mcp_configs),
      plugin_dirs: listToText(profile.options.plugin_dirs),
    });
    toast.success(t("chat.form.profileLoaded"));
  }

  async function handleSaveProfile() {
    const name = profileName.trim();
    if (!name) return;
    setSavingProfile(true);
    try {
      await saveProfile(
        name,
        null,
        finalOptions,
        hooksJsonToRows(finalOptions.hooks_json) ?? [],
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      setProfileName("");
      toast.success(t("chat.form.profileSaved"));
    } catch (error) {
      toast.error(t("chat.form.profileSaveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const fieldErrors = await validateLaunchOptions(finalOptions);
      if (fieldErrors.length > 0) {
        setErrors(groupFieldErrors(fieldErrors));
        return;
      }
      setErrors({});
      if (finalOptions.permission_mode === "bypassPermissions") {
        setBypassOpen(true);
        return;
      }
      await launch(finalOptions);
    } finally {
      setSubmitting(false);
    }
  }

  const descriptionKey = activePresetId
    ? (PRESET_DESCRIPTION_KEYS[activePresetId] ?? "chat.preset.custom.desc")
    : "chat.preset.custom.desc";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h2 className="text-lg font-semibold tracking-tight">
        {t("chat.form.title")}
      </h2>

      <section className="dash-panel-muted flex flex-wrap items-center gap-2 p-3">
        {profiles && profiles.length > 0 && (
          <Select
            value={loadedProfile ?? undefined}
            onValueChange={(name) => {
              const profile = profiles.find((p) => p.name === name);
              if (profile) applyProfile(profile);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("chat.form.loadProfile")} />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.name} value={profile.name}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex flex-1 justify-end gap-2">
          <Input
            className="w-44 text-base"
            placeholder={t("chat.form.profileNamePlaceholder")}
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-center"
            disabled={savingProfile || !profileName.trim()}
            onClick={() => void handleSaveProfile()}
          >
            {t("chat.form.saveAsProfile")}
          </Button>
        </div>
      </section>

      <section className="dash-panel space-y-4 p-4">
        <Field
          label={t("chat.form.name")}
          htmlFor="chat-name"
          error={errors.name}
        >
          <Input
            id="chat-name"
            className="text-base"
            placeholder={t("chat.form.namePlaceholder")}
            value={options.name ?? ""}
            onChange={(event) => set("name", event.target.value || null)}
          />
        </Field>

        <Field
          label={t("chat.form.project")}
          htmlFor="chat-project"
          error={cwdError}
        >
          <Select
            value={pickerValue}
            onValueChange={(value) => {
              if (value === CUSTOM_CWD) {
                setCustomPicked(true);
                return;
              }
              setCustomPicked(false);
              const entry = pickerEntries.find(
                (candidate) => candidate.projectId === value,
              );
              if (entry?.cwd) set("cwd", entry.cwd);
            }}
          >
            <SelectTrigger
              id="chat-project"
              className="w-full"
              aria-invalid={Boolean(cwdError)}
            >
              <SelectValue placeholder={t("chat.form.projectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {pickerEntries.map((entry) => (
                <SelectItem
                  key={entry.projectId}
                  value={entry.projectId}
                  disabled={entry.disabled}
                >
                  <span className="truncate">{entry.name}</span>
                  {entry.cwd && (
                    <span className="mono truncate text-xs text-muted-foreground">
                      {entry.cwd}
                    </span>
                  )}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_CWD}>
                {t("chat.form.customPath")}
              </SelectItem>
            </SelectContent>
          </Select>
          {showCwdInput && (
            <Input
              id="chat-cwd"
              className="mono text-base"
              aria-label={t("chat.form.cwd")}
              placeholder={t("chat.form.cwdPlaceholder")}
              value={options.cwd}
              aria-invalid={Boolean(cwdError)}
              onChange={(event) => set("cwd", event.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label={t("chat.form.model")}
            htmlFor="chat-model"
            error={errors.model}
          >
            <Input
              id="chat-model"
              className="text-base"
              list="chat-model-suggestions"
              placeholder={t("chat.form.modelDefault")}
              value={options.model ?? ""}
              onChange={(event) => set("model", event.target.value || null)}
            />
            <datalist id="chat-model-suggestions">
              {config?.model_suggestions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </Field>

          <Field label={t("chat.form.effort")} error={errors.effort}>
            <Select
              value={options.effort ?? "default"}
              onValueChange={(value) =>
                set("effort", value === "default" ? null : value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {t("chat.form.modelDefault")}
                </SelectItem>
                {config?.efforts.map((effort) => (
                  <SelectItem key={effort} value={effort}>
                    {effort}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t("chat.form.budget")}
            htmlFor="chat-budget"
            error={errors.max_budget_usd}
          >
            <Input
              id="chat-budget"
              className="mono text-base"
              type="number"
              min={0}
              step="0.01"
              placeholder={t("chat.form.budgetPlaceholder")}
              value={options.max_budget_usd ?? ""}
              aria-invalid={Boolean(errors.max_budget_usd)}
              onChange={(event) =>
                set(
                  "max_budget_usd",
                  event.target.value === ""
                    ? null
                    : Number(event.target.value),
                )
              }
            />
          </Field>
        </div>

        <Field label={t("chat.form.preset")} error={errors.permission_mode}>
          <div className="flex flex-wrap gap-1.5" role="group">
            {config?.presets.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={activePresetId === preset.id ? "default" : "outline"}
                aria-pressed={activePresetId === preset.id}
                onClick={() => {
                  setOptions((prev) => applyPreset(prev, preset));
                  setListText((prev) => ({
                    ...prev,
                    disallowed_tools: listToText(preset.disallowed_tools),
                  }));
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t(descriptionKey)}</p>
        </Field>
      </section>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group w-full justify-between"
          >
            {t("chat.form.advanced")}
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <section className="dash-panel-muted mt-2 space-y-4 p-4">
            <Field label={t("chat.form.permissionMode")}>
              <Select
                value={options.permission_mode ?? "acceptEdits"}
                onValueChange={(value) => set("permission_mode", value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config?.permission_modes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={t("chat.form.allowedTools")}
                htmlFor="chat-allowed-tools"
                error={errors.allowed_tools}
                hint={t("chat.form.listHint")}
              >
                <Textarea
                  id="chat-allowed-tools"
                  className="mono min-h-16 text-base"
                  value={listText.allowed_tools}
                  onChange={(event) =>
                    setListText((prev) => ({
                      ...prev,
                      allowed_tools: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label={t("chat.form.disallowedTools")}
                htmlFor="chat-disallowed-tools"
                error={errors.disallowed_tools}
                hint={t("chat.form.listHint")}
              >
                <Textarea
                  id="chat-disallowed-tools"
                  className="mono min-h-16 text-base"
                  value={listText.disallowed_tools}
                  onChange={(event) =>
                    setListText((prev) => ({
                      ...prev,
                      disallowed_tools: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <Field
              label={t("chat.form.mcpConfigs")}
              htmlFor="chat-mcp-configs"
              error={errors.mcp_configs}
              hint={t("chat.form.listHint")}
            >
              <Textarea
                id="chat-mcp-configs"
                className="mono min-h-16 text-base"
                value={listText.mcp_configs}
                onChange={(event) =>
                  setListText((prev) => ({
                    ...prev,
                    mcp_configs: event.target.value,
                  }))
                }
              />
            </Field>
            <CheckboxRow
              id="chat-strict-mcp"
              label={t("chat.form.strictMcp")}
              checked={options.strict_mcp_config}
              onChange={(checked) => set("strict_mcp_config", checked)}
            />

            <Field
              label={t("chat.form.pluginDirs")}
              htmlFor="chat-plugin-dirs"
              error={errors.plugin_dirs}
              hint={t("chat.form.listHint")}
            >
              <Textarea
                id="chat-plugin-dirs"
                className="mono min-h-16 text-base"
                value={listText.plugin_dirs}
                onChange={(event) =>
                  setListText((prev) => ({
                    ...prev,
                    plugin_dirs: event.target.value,
                  }))
                }
              />
            </Field>

            <Field
              label={t("chat.form.agentsJson")}
              htmlFor="chat-agents-json"
              error={errors.agents_json}
            >
              <Textarea
                id="chat-agents-json"
                className="mono min-h-16 text-base"
                aria-invalid={Boolean(errors.agents_json)}
                value={options.agents_json ?? ""}
                onChange={(event) =>
                  set("agents_json", event.target.value || null)
                }
              />
            </Field>

            <Field
              label={t("chat.form.hooksJson")}
              htmlFor="chat-hooks-json"
              error={errors.hooks_json}
            >
              <Textarea
                id="chat-hooks-json"
                className="mono min-h-16 text-base"
                aria-invalid={Boolean(errors.hooks_json)}
                value={options.hooks_json ?? ""}
                onChange={(event) =>
                  set("hooks_json", event.target.value || null)
                }
              />
            </Field>

            <Field
              label={t("chat.form.settingSources")}
              error={errors.setting_sources}
            >
              <div className="flex flex-wrap gap-4">
                {config?.setting_sources.map((source) => (
                  <CheckboxRow
                    key={source}
                    id={`chat-setting-source-${source}`}
                    label={source}
                    checked={options.setting_sources.includes(source)}
                    onChange={(checked) =>
                      set(
                        "setting_sources",
                        checked
                          ? [...options.setting_sources, source]
                          : options.setting_sources.filter(
                              (item) => item !== source,
                            ),
                      )
                    }
                  />
                ))}
              </div>
            </Field>

            <Field
              label={t("chat.form.appendSystemPrompt")}
              htmlFor="chat-append-system-prompt"
              error={errors.append_system_prompt}
            >
              <Textarea
                id="chat-append-system-prompt"
                className="min-h-16 text-base"
                value={options.append_system_prompt ?? ""}
                onChange={(event) =>
                  set("append_system_prompt", event.target.value || null)
                }
              />
            </Field>

            <Field
              label={t("chat.form.settingsJson")}
              htmlFor="chat-settings-json"
              error={errors.settings_json}
            >
              <Textarea
                id="chat-settings-json"
                className="mono min-h-16 text-base"
                aria-invalid={Boolean(errors.settings_json)}
                value={options.settings_json ?? ""}
                onChange={(event) =>
                  set("settings_json", event.target.value || null)
                }
              />
            </Field>

            <div className="space-y-2">
              <CheckboxRow
                id="chat-worktree"
                label={t("chat.form.worktree")}
                checked={options.worktree}
                onChange={(checked) => set("worktree", checked)}
              />
              {options.worktree && (
                <Field
                  label={t("chat.form.worktreeName")}
                  htmlFor="chat-worktree-name"
                >
                  <Input
                    id="chat-worktree-name"
                    className="mono text-base"
                    placeholder={t("chat.form.worktreeNamePlaceholder")}
                    value={options.worktree_name ?? ""}
                    onChange={(event) =>
                      set("worktree_name", event.target.value || null)
                    }
                  />
                </Field>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={t("chat.form.resumeSessionId")}
                htmlFor="chat-resume-id"
                error={errors.resume_session_id}
              >
                <Input
                  id="chat-resume-id"
                  className="mono text-base"
                  aria-invalid={Boolean(errors.resume_session_id)}
                  value={options.resume_session_id ?? ""}
                  onChange={(event) =>
                    set("resume_session_id", event.target.value || null)
                  }
                />
              </Field>
              <div className="flex items-end pb-2">
                <CheckboxRow
                  id="chat-fork-session"
                  label={t("chat.form.forkSession")}
                  checked={options.fork_session}
                  onChange={(checked) => set("fork_session", checked)}
                />
              </div>
            </div>
          </section>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-end">
        <Button
          type="button"
          className={cn("dash-focus-ring", submitting && "opacity-80")}
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? t("chat.form.starting") : t("chat.form.start")}
        </Button>
      </div>

      <AlertDialog open={bypassOpen} onOpenChange={setBypassOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.bypass.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chat.bypass.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.bypass.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBypassOpen(false);
                void launch(finalOptions);
              }}
            >
              {t("chat.bypass.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
