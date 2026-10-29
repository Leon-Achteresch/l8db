import { openPath } from "@tauri-apps/plugin-opener";
import { BotIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { removeUiPlugin } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { reloadUiPlugins } from "@/lib/ui-plugins/host";
import { useUiPluginSettings } from "@/lib/ui-plugins/settings";
import { uiPluginStatuses } from "@/lib/ui-plugins/status";
import { useUiPluginRuntime } from "@/lib/ui-plugins/store";
import { UiPluginCard } from "./ui-plugin-card";
import { UiPluginGallery } from "./ui-plugin-gallery";

function aiPrompt(dir: string | null) {
  return `Baue mir ein l8db UI-Plugin. Arbeitsordner: ${dir ?? "~/.l8db/ui"}
Lies zuerst AGENTS.md und l8db-ui.d.ts in diesem Ordner. Lege genau eine .tsx-Datei an.
Prüfe danach .status.json: Die Datei muss "active" sein und darf keine slotErrors haben.

Mein Wunsch: `;
}

export function UiPluginsSection() {
  const feature = useNewFeatureVisibility<HTMLElement>("settings.extensions.ui-plugins");
  const runtime = useUiPluginRuntime(
    useShallow((state) => ({
      ready: state.ready,
      dir: state.dir,
      loaded: state.loaded,
      errors: state.errors,
      skipped: state.skipped,
      slotErrors: state.slotErrors,
      tripped: state.tripped,
      runtimeErrors: state.runtimeErrors,
    })),
  );
  const settings = useUiPluginSettings(
    useShallow((state) => ({
      disabled: state.disabled,
      httpGrants: state.httpGrants,
      installed: state.installed,
    })),
  );
  const forgetInstalled = useUiPluginSettings((state) => state.forgetInstalled);
  const statuses = useMemo(() => uiPluginStatuses(runtime, settings), [runtime, settings]);

  const remove = async (id: string, file: string) => {
    try {
      await removeUiPlugin(file);
      forgetInstalled(id);
      await reloadUiPlugins();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section
      ref={feature.ref}
      data-setting-id="ui-plugins"
      tabIndex={-1}
      className="@container space-y-4 border-t border-border/60 pt-6"
      aria-labelledby="ui-plugins-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="ui-plugins-heading" className="flex items-center gap-1.5 text-sm font-semibold">
            UI-Plugins
            {feature.isNew && <NewBadge />}
          </h3>
          <p className="max-w-xl text-xs text-pretty text-muted-foreground">
            Tabellen, Tab-Leiste und geteilte Ansichten nach eigenen Wünschen umbauen. Ein Plugin
            ist eine React-Datei im Plugin-Ordner, geschrieben von dir oder einer KI. Änderungen
            wirken sofort, ohne Neustart.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void copyText(aiPrompt(runtime.dir), "Anleitung für die KI kopiert").catch((cause) =>
                toast.error(String(cause)),
              )
            }
          >
            <BotIcon />
            Mit KI bauen
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!runtime.dir}
            onClick={() =>
              runtime.dir && void openPath(runtime.dir).catch((cause) => toast.error(String(cause)))
            }
          >
            <FolderOpenIcon />
            Ordner öffnen
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="UI-Plugins neu laden"
            onClick={() => void reloadUiPlugins()}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </div>
      {runtime.dir && (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={runtime.dir}>
          {runtime.dir}
        </p>
      )}
      <div className="space-y-3">
        {statuses.map((status) => {
          const id = status.id;
          const installedFile = id ? settings.installed[id]?.file : undefined;
          return (
            <UiPluginCard
              key={status.file}
              status={status}
              onRemove={
                id && installedFile === status.file ? () => void remove(id, status.file) : undefined
              }
            />
          );
        })}
        {runtime.ready && statuses.length === 0 && (
          <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            Noch keine UI-Plugins. Unten aus der Galerie installieren oder mit „Mit KI bauen“ ein
            eigenes anlegen lassen.
          </p>
        )}
        {runtime.skipped.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {runtime.skipped.map((file) => (
              <li key={file.name}>
                <span className="font-mono">{file.name}</span> übersprungen: {file.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
      <UiPluginGallery />
    </section>
  );
}
