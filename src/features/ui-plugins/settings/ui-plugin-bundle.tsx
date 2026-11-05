import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { diffLines } from "@/lib/ai/editor/line-diff";
import {
  exportUiPluginBundle,
  readUiPluginBundle,
  scanUiPlugins,
  writeUiPlugin,
} from "@/lib/db/ui-plugins";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  applyBundle,
  type BundlePreview,
  encodeBundle,
  previewBundle,
} from "@/lib/ui-plugins/bundle";
import { checkUiPluginSource, reloadUiPlugins } from "@/lib/ui-plugins/host";
import { useUiPluginSettings } from "@/lib/ui-plugins/settings";

export function UiPluginBundle() {
  const feature = useNewFeatureVisibility<HTMLDivElement>("settings.extensions.ui-plugins.bundle");
  const [entries, setEntries] = useState<BundlePreview[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"import" | "export">("import");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const prepare = (next: "import" | "export") =>
    run(async () => {
      const files = (await scanUiPlugins()).files;
      let value: unknown;
      if (next === "import") {
        const path = await open({
          multiple: false,
          filters: [{ name: "UI-Plugins", extensions: ["json"] }],
        });
        if (!path) return;
        value = await readUiPluginBundle(path);
      } else {
        if (!files.length) throw new Error("Keine Plugins zum Exportieren.");
        value = {
          format: "l8db.ui-plugins",
          version: 1,
          plugins: files.map((file) => ({ ...file, options: {} })),
        };
      }
      const preview = await previewBundle(value, files, checkUiPluginSource);
      if (next === "export") {
        const options = useUiPluginSettings.getState().options;
        for (const entry of preview) entry.options = entry.id ? (options[entry.id] ?? {}) : {};
      }
      setMode(next);
      setEntries(preview);
      setSelected(new Set(preview.filter((e) => !e.error).map((e) => e.name)));
    });
  const confirm = () =>
    run(async () => {
      const chosen = entries?.filter((e) => selected.has(e.name) && !e.error) ?? [];
      if (mode === "export") {
        const path = await save({
          defaultPath: "ui-plugins.json",
          filters: [{ name: "UI-Plugins", extensions: ["json"] }],
        });
        if (!path) return;
        await exportUiPluginBundle(
          path,
          encodeBundle(
            chosen.map(({ name, source, options, requiredHttpHosts }) => ({
              name,
              source,
              options,
              requiredHttpHosts,
            })),
          ),
        );
      } else {
        const current = (await scanUiPlugins()).files;
        await applyBundle(entries ?? [], selected, current, checkUiPluginSource, async (entry) => {
          await writeUiPlugin(entry.name, entry.source);
          const settings = useUiPluginSettings.getState();
          if (entry.id) {
            const httpGrants = { ...settings.httpGrants };
            delete httpGrants[entry.id];
            useUiPluginSettings.setState({
              options: { ...settings.options, [entry.id]: entry.options },
              httpGrants,
            });
          }
        });
        await reloadUiPlugins();
      }
      setEntries(null);
      toast.success(mode === "export" ? "Plugins exportiert" : "Plugins importiert");
    });
  return (
    <div ref={feature.ref} className="flex gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void prepare("export")}>
        Exportieren
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void prepare("import")}>
        Importieren
      </Button>
      <Dialog
        open={entries !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setEntries(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
          <DialogTitle>UI-Plugins {mode === "import" ? "importieren" : "exportieren"}</DialogTitle>
          <p className="text-sm">HTTP-Freigaben werden nicht übertragen.</p>
          {entries?.map((entry) => (
            <article key={entry.key} className="space-y-2 bg-muted/40 p-3">
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  disabled={busy || !!entry.error}
                  checked={!entry.error && selected.has(entry.name)}
                  onChange={(event) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (event.target.checked) next.add(entry.name);
                      else next.delete(entry.name);
                      return next;
                    })
                  }
                />
                {entry.name} ·{" "}
                {entry.error
                  ? "Fehlerhaft"
                  : entry.before === undefined
                    ? "Neu"
                    : entry.before === entry.source
                      ? "Identisch"
                      : "Überschreiben"}
              </label>
              {entry.error && <p role="alert">{entry.error}</p>}
              <p className="text-xs">HTTP: {entry.requiredHttpHosts.join(", ") || "Keine"}</p>
              <details>
                <summary>
                  Code
                  {entry.before !== undefined && entry.before !== entry.source ? " und Diff" : ""}
                </summary>
                <pre className="max-h-60 overflow-auto text-xs">{entry.source}</pre>
                {entry.before !== undefined && entry.before !== entry.source && (
                  <pre className="max-h-60 overflow-auto text-xs">
                    {diffLines(entry.before, entry.source, { maxCells: 100_000 })
                      .map((h) =>
                        [
                          ...h.oldLines.map((l) => `- ${l}`),
                          ...h.newLines.map((l) => `+ ${l}`),
                        ].join("\n"),
                      )
                      .join("\n")}
                  </pre>
                )}
              </details>
            </article>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setEntries(null)}>
              Abbrechen
            </Button>
            <Button disabled={busy || !selected.size} onClick={() => void confirm()}>
              Auswahl {mode === "import" ? "übernehmen" : "speichern"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
