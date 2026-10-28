import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Pause, Play, TriangleAlert, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConvexFunctionHistory } from "@/features/baas/convex-studio/functions/convex-function-history-store";
import { NameConfirmDialog } from "@/features/versioning/database/name-confirm-dialog";
import { convexDisconnect } from "@/lib/db";
import { convexStudioSettingsSetPaused } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { convexSettingsKey, useConvexSettingsInfo } from "./use-convex-settings-info";

const route = getRouteApi("/baas");

type Action = "pause" | "resume" | "disconnect";

export function ConvexSettingsDanger({ deployment }: { deployment: ConvexStudioDeployment }) {
  const queryClient = useQueryClient();
  const search = route.useSearch();
  const navigate = useNavigate();
  const info = useConvexSettingsInfo(deployment);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const paused = info.data?.state === "paused";

  async function run(current: Action) {
    setBusy(true);
    try {
      if (current === "disconnect") {
        await convexDisconnect(deployment.profileId);
        useConvexFunctionHistory.getState().clearProfile(deployment.profileId);
        queryClient.removeQueries({ queryKey: ["convex", deployment.profileId] });
        await queryClient.invalidateQueries({ queryKey: ["convex", "profiles"] });
        await navigate({
          to: "/baas",
          search: {
            ...search,
            id: undefined,
            project: undefined,
            deployment: undefined,
            studio: undefined,
          },
        });
        return;
      }
      await convexStudioSettingsSetPaused(deployment, current === "pause");
      toast.success(current === "pause" ? "Deployment pausiert." : "Deployment läuft wieder.");
      await queryClient.invalidateQueries({ queryKey: convexSettingsKey(deployment, "info") });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-destructive/40 bg-card p-5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 text-destructive" />
        <h3 className="text-sm font-semibold">Gefahrenzone</h3>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/50 p-3">
          <div>
            <p className="text-xs font-medium">
              {paused ? "Deployment fortsetzen" : "Deployment pausieren"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {paused
                ? "Funktionen, HTTP-Actions, Cronjobs und geplante Funktionen laufen wieder."
                : "Blockiert alle Funktionsaufrufe, HTTP-Actions, Cronjobs und geplanten Funktionen, bis das Deployment fortgesetzt wird. Daten bleiben erhalten."}
            </p>
          </div>
          <Button
            variant={paused ? "outline" : "destructive"}
            size="sm"
            disabled={busy || !info.data?.state}
            onClick={() => setAction(paused ? "resume" : "pause")}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Fortsetzen" : "Pausieren"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/50 p-3">
          <div>
            <p className="text-xs font-medium">Von l8db trennen</p>
            <p className="text-[11px] text-muted-foreground">
              {deployment.selfHosted
                ? "Entfernt diese Instanz und ihren Admin-Key aus l8db. Die Instanz selbst bleibt unverändert."
                : "Entfernt den Team-Token und damit alle Projekte dieses Teams aus l8db. Die Deployments bleiben unverändert."}
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
      </div>
      {action && (
        <NameConfirmDialog
          title={
            action === "pause"
              ? `„${deployment.title}“ pausieren?`
              : action === "resume"
                ? `„${deployment.title}“ fortsetzen?`
                : `„${deployment.title}“ trennen?`
          }
          description={
            action === "disconnect"
              ? "Gespeicherte Schlüssel werden aus dem OS-Schlüsselbund gelöscht."
              : "Die Aktion wird direkt im Convex-Deployment ausgeführt."
          }
          name={deployment.title}
          requireName={action !== "resume"}
          action={action === "pause" ? "Pausieren" : action === "resume" ? "Fortsetzen" : "Trennen"}
          destructive={action !== "resume"}
          onConfirm={() => void run(action)}
          onClose={() => setAction(null)}
        />
      )}
    </section>
  );
}
