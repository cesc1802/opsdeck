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
import { Textarea } from "@/components/ui/textarea";
import type { ChatProfile } from "@/lib/bindings";
import { fetchProfiles, saveProfile } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { Field } from "@/features/chat/form-fields";
import {
  type AgentRow,
  agentsJsonToRows,
  emptyAgentRow,
  rowsToAgentsJson,
  validateAgentRows,
} from "./builder-model";

/** Edits a profile's `agents_json` as structured rows. */
export function AgentBuilderTab() {
  const queryClient = useQueryClient();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [invalidJson, setInvalidJson] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: profiles } = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
  });

  const selected = profiles?.find((p) => p.name === selectedName) ?? null;
  const errors = validateAgentRows(rows);
  const hasErrors = Object.keys(errors).length > 0;

  function selectProfile(profile: ChatProfile) {
    setSelectedName(profile.name);
    const parsed = agentsJsonToRows(profile.options.agents_json);
    setInvalidJson(parsed === null);
    setRows(parsed ?? []);
  }

  function updateRow(index: number, patch: Partial<AgentRow>) {
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
        agents_json: rowsToAgentsJson(rows),
      };
      await saveProfile(selected.name, null, options, selected.hook_builder);
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
          {invalidJson && (
            <p className="text-xs text-destructive">
              {t("config.builder.invalidJson")}
            </p>
          )}

          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("config.agents.empty")}
            </p>
          )}

          {rows.map((row, index) => (
            <div key={index} className="dash-panel space-y-3 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={t("config.agents.name")}
                  htmlFor={`agent-name-${index}`}
                >
                  <Input
                    id={`agent-name-${index}`}
                    className="mono text-base"
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                  />
                </Field>
                <Field
                  label={t("config.agents.model")}
                  htmlFor={`agent-model-${index}`}
                >
                  <Input
                    id={`agent-model-${index}`}
                    className="mono text-base"
                    value={row.model}
                    onChange={(e) =>
                      updateRow(index, { model: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field
                label={t("config.agents.description")}
                htmlFor={`agent-description-${index}`}
              >
                <Input
                  id={`agent-description-${index}`}
                  className="text-base"
                  value={row.description}
                  onChange={(e) =>
                    updateRow(index, { description: e.target.value })
                  }
                />
              </Field>
              <Field
                label={t("config.agents.prompt")}
                htmlFor={`agent-prompt-${index}`}
              >
                <Textarea
                  id={`agent-prompt-${index}`}
                  className="min-h-16 text-base"
                  value={row.prompt}
                  onChange={(e) => updateRow(index, { prompt: e.target.value })}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                {errors[index] ? (
                  <p className="text-xs text-destructive">{errors[index]}</p>
                ) : (
                  <span />
                )}
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
              onClick={() => setRows((prev) => [...prev, emptyAgentRow()])}
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
