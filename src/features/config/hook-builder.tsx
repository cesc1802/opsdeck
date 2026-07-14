import { useState } from "react";
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
import type { ChatProfile, HookRow } from "@/lib/bindings";
import { fetchChatConfig, fetchProfiles, saveProfile } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { CheckboxRow, Field } from "@/features/chat/form-fields";
import {
  emptyHookRow,
  hooksJsonToRows,
  rowsToHooksJson,
  validateHookRows,
} from "./builder-model";

/** Edits a profile's hook rows; compiles to `hooks_json` on save. OpsDeck
 * only stores these — commands are never executed here. */
export function HookBuilderTab() {
  const queryClient = useQueryClient();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [rows, setRows] = useState<HookRow[]>([]);
  const [invalidJson, setInvalidJson] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: profiles } = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
  });
  const { data: config } = useQuery({
    queryKey: queryKeys.chatConfig,
    queryFn: fetchChatConfig,
    staleTime: Infinity,
  });

  const events = config?.hook_events ?? [];
  const selected = profiles?.find((p) => p.name === selectedName) ?? null;
  const errors = validateHookRows(rows, events);
  const hasErrors = Object.keys(errors).length > 0;

  function selectProfile(profile: ChatProfile) {
    setSelectedName(profile.name);
    if (profile.hook_builder.length > 0) {
      setInvalidJson(false);
      setRows(profile.hook_builder);
      return;
    }
    const parsed = hooksJsonToRows(profile.options.hooks_json);
    setInvalidJson(parsed === null);
    setRows(parsed ?? []);
  }

  function updateRow(index: number, patch: Partial<HookRow>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const options = {
        ...selected.options,
        hooks_json: rowsToHooksJson(rows),
      };
      await saveProfile(selected.name, null, options, rows);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      setInvalidJson(false);
      toast.success(t("config.builder.saved"));
    } catch (error) {
      toast.error(t("config.builder.saveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  if (profiles && profiles.length === 0) {
    return (
      <p className="dash-panel-muted p-6 text-center text-sm text-muted-foreground">
        {t("config.builder.noProfiles")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Field label={t("config.builder.profile")}>
        <Select
          value={selectedName ?? undefined}
          onValueChange={(name) => {
            const profile = profiles?.find((p) => p.name === name);
            if (profile) selectProfile(profile);
          }}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder={t("config.builder.selectProfile")} />
          </SelectTrigger>
          <SelectContent>
            {profiles?.map((profile) => (
              <SelectItem key={profile.name} value={profile.name}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {selected && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("config.hooks.note")}
          </p>

          {invalidJson && (
            <p className="text-xs text-destructive">
              {t("config.builder.invalidJson")}
            </p>
          )}

          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("config.hooks.empty")}
            </p>
          )}

          {rows.map((row, index) => (
            <div key={index} className="dash-panel space-y-3 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t("config.hooks.event")}>
                  <Select
                    value={row.event || undefined}
                    onValueChange={(event) => updateRow(index, { event })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((event) => (
                        <SelectItem key={event} value={event}>
                          {event}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={t("config.hooks.matcher")}
                  htmlFor={`hook-matcher-${index}`}
                >
                  <Input
                    id={`hook-matcher-${index}`}
                    className="mono text-base"
                    value={row.matcher ?? ""}
                    onChange={(e) =>
                      updateRow(index, { matcher: e.target.value || null })
                    }
                  />
                </Field>
                <Field
                  label={t("config.hooks.timeout")}
                  htmlFor={`hook-timeout-${index}`}
                >
                  <Input
                    id={`hook-timeout-${index}`}
                    className="mono text-base"
                    type="number"
                    min={1}
                    value={row.timeout}
                    onChange={(e) =>
                      updateRow(index, { timeout: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field
                label={t("config.hooks.command")}
                htmlFor={`hook-command-${index}`}
              >
                <Input
                  id={`hook-command-${index}`}
                  className="mono text-base"
                  value={row.command}
                  onChange={(e) =>
                    updateRow(index, { command: e.target.value })
                  }
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-4">
                  <CheckboxRow
                    id={`hook-enabled-${index}`}
                    label={t("config.hooks.enabled")}
                    checked={row.enabled}
                    onChange={(enabled) => updateRow(index, { enabled })}
                  />
                  {errors[index] && (
                    <p className="text-xs text-destructive">{errors[index]}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  {t("config.builder.remove")}
                </Button>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows((prev) => [...prev, emptyHookRow(events)])}
            >
              {t("config.builder.addRow")}
            </Button>
            <Button
              size="sm"
              disabled={saving || hasErrors}
              onClick={() => void handleSave()}
            >
              {t("config.builder.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
