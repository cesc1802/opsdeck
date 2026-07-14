import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChatProfile, LaunchOptions } from "@/lib/bindings";
import { fetchChatConfig, saveProfile, validateLaunchOptions } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { Field } from "@/features/chat/form-fields";
import {
  defaultLaunchOptions,
  groupFieldErrors,
  listToText,
  textToList,
} from "@/features/chat/launch-presets";
import { hooksJsonToRows } from "./builder-model";

interface ProfileEditorProps {
  /** null creates a new profile; otherwise edits (rename drops the old row). */
  profile: ChatProfile | null;
  onDone: () => void;
}

/** Trimmed New Chat form over the same LaunchOptions contract; builders for
 * agents/hooks live in their own tabs, so those stay raw JSON here. */
export function ProfileEditor({ profile, onDone }: ProfileEditorProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile?.name ?? "");
  const [options, setOptions] = useState<LaunchOptions>(
    () => profile?.options ?? defaultLaunchOptions(),
  );
  const [listText, setListText] = useState(() => ({
    allowed_tools: listToText(profile?.options.allowed_tools ?? []),
    disallowed_tools: listToText(profile?.options.disallowed_tools ?? []),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: config } = useQuery({
    queryKey: queryKeys.chatConfig,
    queryFn: fetchChatConfig,
    staleTime: Infinity,
  });

  const set = <K extends keyof LaunchOptions>(
    key: K,
    value: LaunchOptions[K],
  ) => setOptions((prev) => ({ ...prev, [key]: value }));

  const finalOptions = useMemo<LaunchOptions>(
    () => ({
      ...options,
      allowed_tools: textToList(listText.allowed_tools),
      disallowed_tools: textToList(listText.disallowed_tools),
    }),
    [options, listText],
  );

  async function handleSave() {
    if (!name.trim()) {
      setErrors({ profile_name: t("config.editor.nameRequired") });
      return;
    }
    setSaving(true);
    try {
      const fieldErrors = await validateLaunchOptions(finalOptions);
      if (fieldErrors.length > 0) {
        setErrors(groupFieldErrors(fieldErrors));
        return;
      }
      setErrors({});
      const hookRows = hooksJsonToRows(finalOptions.hooks_json) ?? [];
      await saveProfile(name.trim(), profile?.name ?? null, finalOptions, hookRows);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      toast.success(t("config.editor.saved"));
      onDone();
    } catch (error) {
      toast.error(t("config.editor.saveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dash-panel space-y-4 p-4">
      <h3 className="text-sm font-semibold tracking-tight">
        {profile ? t("config.editor.editTitle") : t("config.editor.newTitle")}
      </h3>

      <Field
        label={t("config.editor.name")}
        htmlFor="profile-name"
        error={errors.profile_name}
      >
        <Input
          id="profile-name"
          className="text-base"
          value={name}
          aria-invalid={Boolean(errors.profile_name)}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label={t("chat.form.cwd")}
        htmlFor="profile-cwd"
        error={errors.cwd}
      >
        <Input
          id="profile-cwd"
          className="mono text-base"
          placeholder={t("chat.form.cwdPlaceholder")}
          value={options.cwd}
          aria-invalid={Boolean(errors.cwd)}
          onChange={(event) => set("cwd", event.target.value)}
        />
      </Field>

      <Field
        label={t("chat.form.prompt")}
        htmlFor="profile-prompt"
        error={errors.prompt}
      >
        <Textarea
          id="profile-prompt"
          className="min-h-20 text-base"
          placeholder={t("chat.form.promptPlaceholder")}
          value={options.prompt}
          aria-invalid={Boolean(errors.prompt)}
          onChange={(event) => set("prompt", event.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label={t("chat.form.model")}
          htmlFor="profile-model"
          error={errors.model}
        >
          <Input
            id="profile-model"
            className="text-base"
            placeholder={t("chat.form.modelDefault")}
            value={options.model ?? ""}
            onChange={(event) => set("model", event.target.value || null)}
          />
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
          label={t("chat.form.permissionMode")}
          error={errors.permission_mode}
        >
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("chat.form.allowedTools")}
          htmlFor="profile-allowed-tools"
          error={errors.allowed_tools}
          hint={t("chat.form.listHint")}
        >
          <Textarea
            id="profile-allowed-tools"
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
          htmlFor="profile-disallowed-tools"
          error={errors.disallowed_tools}
          hint={t("chat.form.listHint")}
        >
          <Textarea
            id="profile-disallowed-tools"
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
        label={t("chat.form.agentsJson")}
        htmlFor="profile-agents-json"
        error={errors.agents_json}
      >
        <Textarea
          id="profile-agents-json"
          className="mono min-h-16 text-base"
          aria-invalid={Boolean(errors.agents_json)}
          value={options.agents_json ?? ""}
          onChange={(event) => set("agents_json", event.target.value || null)}
        />
      </Field>

      <Field
        label={t("chat.form.hooksJson")}
        htmlFor="profile-hooks-json"
        error={errors.hooks_json}
      >
        <Textarea
          id="profile-hooks-json"
          className="mono min-h-16 text-base"
          aria-invalid={Boolean(errors.hooks_json)}
          value={options.hooks_json ?? ""}
          onChange={(event) => set("hooks_json", event.target.value || null)}
        />
      </Field>

      <Field
        label={t("chat.form.appendSystemPrompt")}
        htmlFor="profile-append-system-prompt"
        error={errors.append_system_prompt}
      >
        <Textarea
          id="profile-append-system-prompt"
          className="min-h-16 text-base"
          value={options.append_system_prompt ?? ""}
          onChange={(event) =>
            set("append_system_prompt", event.target.value || null)
          }
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("config.editor.cancel")}
        </Button>
        <Button type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? t("config.editor.saving") : t("config.editor.save")}
        </Button>
      </div>
    </section>
  );
}
