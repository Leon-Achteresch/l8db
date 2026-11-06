import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, TriangleAlert, Unplug } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NameConfirmDialog } from "@/features/versioning/database/name-confirm-dialog";
import type { SupabaseProject, SupabaseStudioCapabilities } from "@/lib/db";
import { supabaseStudioSettingsSetPaused } from "@/lib/db/supabase-studio-settings";
import { disconnectSupabase } from "../../disconnect-baas";

type Action = "pause" | "restore" | "disconnect";

export function SupabaseSettingsDanger({
  project,
  capabilities,
}: {
  project: SupabaseProject;
  capabilities: SupabaseStudioCapabilities;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = project.status === "INACTIVE" || project.status === "PAUSED";

  async function run(current: Action, confirm: string) {
    setBusy(true);
    setError(null);
    try {
      if (current === "disconnect") {
        await disconnectSupabase(project.reference, Boolean(project.self_hosted));
        queryClient.removeQueries({ queryKey: ["supabase", "projects"] });
        await queryClient.invalidateQueries({ queryKey: ["supabase", "connected"] });
        return;
      }
      await supabaseStudioSettingsSetPaused(project.reference, current === "pause", confirm);
      await queryClient.invalidateQueries({ queryKey: ["supabase", "projects"] });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-destructive/5 p-5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 text-destructive" />
        <h3 className="text-sm font-semibold">Gefahrenzone</h3>
      </div>
      <div className="mt-4 space-y-3">
        {capabilities.management && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background/50 p-3">
            <div>
              <p className="text-xs font-medium">
                {paused ? "Projekt wiederherstellen" : "Projekt pausieren"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {paused
                  ? "Startet das pausierte Projekt wieder. Das kann einige Minuten dauern."
                  : "Stoppt Datenbank und Dienste. Apps können das Projekt bis zur Wiederherstellung nicht nutzen."}
              </p>
            </div>
            <Button
              variant={paused ? "outline" : "destructive"}
              size="sm"
              disabled={busy}
              onClick={() => setAction(paused ? "restore" : "pause")}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? "Wiederherstellen" : "Pausieren"}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background/50 p-3">
          <div>
            <p className="text-xs font-medium">Von l8db trennen</p>
            <p className="text-[11px] text-muted-foreground">
              {project.self_hosted
                ? "Entfernt diese Instanz und ihren Key aus l8db. Die Instanz selbst bleibt unverändert."
                : "Entfernt den Supabase-Zugangstoken und gespeicherte Projekt-Keys aller Cloud-Projekte aus l8db. Die Projekte bleiben unverändert."}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => setAction("disconnect")}
          >
            <Unplug className="size-3.5" /> Trennen
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {action && (
        <NameConfirmDialog
          title={
            action === "pause"
              ? `„${project.name}“ pausieren?`
              : action === "restore"
                ? `„${project.name}“ wiederherstellen?`
                : project.self_hosted
                  ? `„${project.name}“ trennen?`
                  : "Supabase Cloud trennen?"
          }
          description={
            action === "disconnect"
              ? "Gespeicherte Schlüssel werden aus dem OS-Schlüsselbund gelöscht."
              : "Die Aktion wird direkt in deinem Supabase-Projekt ausgeführt."
          }
          name={project.name}
          requireName
          action={
            action === "pause" ? "Pausieren" : action === "restore" ? "Wiederherstellen" : "Trennen"
          }
          destructive={action !== "restore"}
          onConfirm={(typed) => void run(action, typed)}
          onClose={() => setAction(null)}
        />
      )}
    </section>
  );
}
