import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { writeUiPlugin } from "@/lib/db";
import {
  catalogPluginFileName,
  downloadUiPlugin,
  loadUiPluginCatalog,
  UI_PLUGIN_REPOSITORY,
  type UiPluginCatalog,
  type UiPluginCatalogEntry,
} from "@/lib/ui-plugins/catalog";
import { checkUiPluginSource, reloadUiPlugins } from "@/lib/ui-plugins/host";
import { useUiPluginSettings } from "@/lib/ui-plugins/settings";
import { useUiPluginRuntime } from "@/lib/ui-plugins/store";
import { UiPluginGalleryCard } from "./ui-plugin-gallery-card";

export function UiPluginGallery() {
  const installed = useUiPluginSettings((state) => state.installed);
  const markInstalled = useUiPluginSettings((state) => state.markInstalled);
  const loaded = useUiPluginRuntime((state) => state.loaded);
  const failed = useUiPluginRuntime((state) => state.errors);
  const present = (file: string) => Object.hasOwn(loaded, file) || Object.hasOwn(failed, file);
  const [catalog, setCatalog] = useState<UiPluginCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await loadUiPluginCatalog());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (entry: UiPluginCatalogEntry) => {
    if (pending) return;
    setPending(entry.id);
    try {
      const file = catalogPluginFileName(entry);
      const source = await downloadUiPlugin(entry);
      await checkUiPluginSource(file, source, entry.id);
      await writeUiPlugin(file, source);
      markInstalled(entry.id, { file, version: entry.version, sha256: entry.sha256 });
      await reloadUiPlugins();
      toast.success(
        entry.http.length
          ? `${entry.name} installiert. Netzwerkzugriff oben unter „Installiert“ freigeben.`
          : `${entry.name} installiert und aktiv.`,
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="ui-plugin-gallery">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="ui-plugin-gallery" className="text-sm font-semibold">
            Galerie
          </h4>
          <p className="text-xs text-pretty text-muted-foreground">
            Öffentliche UI-Plugins mit Screenshot, per Pull Request geprüft und vor der Installation
            per SHA-256 verifiziert.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void openUrl(UI_PLUGIN_REPOSITORY)}>
            Einreichen
            <ExternalLinkIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Galerie aktualisieren"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
      {loading && !catalog && (
        <p className="text-xs text-muted-foreground">Galerie wird geladen …</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Galerie nicht verfügbar: {error}
        </p>
      )}
      {catalog && (
        <div className="grid gap-3 @min-[40rem]:grid-cols-2">
          {catalog.plugins.map((entry) => (
            <UiPluginGalleryCard
              key={entry.id}
              entry={entry}
              installed={
                installed[entry.id] && present(installed[entry.id].file)
                  ? installed[entry.id]
                  : undefined
              }
              pending={pending === entry.id}
              onInstall={() => void install(entry)}
            />
          ))}
          {catalog.plugins.length === 0 && (
            <p className="text-xs text-muted-foreground">Die Galerie ist noch leer.</p>
          )}
        </div>
      )}
    </section>
  );
}
