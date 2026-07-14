import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ChatProfile } from "@/lib/bindings";
import {
  deleteProfile,
  exportProfiles,
  fetchProfiles,
  importProfiles,
} from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { ProfileEditor } from "./profile-editor";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

export function ProfilesTab() {
  const queryClient = useQueryClient();
  // null = list view; { profile: null } = creating; { profile } = editing.
  const [editing, setEditing] = useState<{ profile: ChatProfile | null } | null>(
    null,
  );

  const { data: profiles, error } = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
  });

  async function handleExport() {
    try {
      const path = await save({
        defaultPath: "opsdeck-profiles.json",
        filters: JSON_FILTER,
      });
      if (!path) return;
      await exportProfiles(path);
      toast.success(t("config.profiles.exported"));
    } catch (err) {
      toast.error(t("config.profiles.exportFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleImport() {
    try {
      const path = await open({ multiple: false, filters: JSON_FILTER });
      if (typeof path !== "string") return;
      const count = await importProfiles(path);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      toast.success(`${count} ${t("config.profiles.imported")}`);
    } catch (err) {
      toast.error(t("config.profiles.importFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteProfile(name);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    } catch (err) {
      toast.error(t("config.profiles.deleteFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (editing) {
    return (
      <ProfileEditor
        profile={editing.profile}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setEditing({ profile: null })}>
          {t("config.profiles.new")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handleImport()}>
          {t("config.profiles.import")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!profiles?.length}
          onClick={() => void handleExport()}
        >
          {t("config.profiles.export")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          {t("config.profiles.error")}
        </p>
      ) : profiles && profiles.length === 0 ? (
        <div className="dash-panel-muted p-6 text-center">
          <p className="text-sm font-medium">{t("config.profiles.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("config.profiles.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {profiles?.map((profile) => (
            <li
              key={profile.name}
              className="dash-panel flex items-center gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("config.profiles.updated")}{" "}
                  {new Date(profile.updated_at_ms).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing({ profile })}
              >
                {t("config.profiles.edit")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost">
                    {t("config.profiles.delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("config.profiles.deleteTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("config.profiles.deleteBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("config.profiles.deleteCancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleDelete(profile.name)}
                    >
                      {t("config.profiles.deleteConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
