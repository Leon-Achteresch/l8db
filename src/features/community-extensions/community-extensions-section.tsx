import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "motion/react";
import { useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readCommunityExtension } from "@/lib/db";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { CommunityExtensionCard } from "./community-extension-card";

export function CommunityExtensionsSection() {
  const host = useExtensionHost();
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const subscription = host.changes.on("change", refresh);
    return () => subscription.dispose();
  }, [host]);
  const run = (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    void Promise.resolve()
      .then(action)
      .catch((error) => toast.error(String(error)))
      .finally(() => {
        setPending(false);
        refresh();
      });
  };
  const install = async (development: boolean) => {
    const path = await open(
      development
        ? { directory: true, multiple: false }
        : {
            multiple: false,
            filters: [{ name: "l8db Extension", extensions: ["l8db-extension"] }],
          },
    );
    if (typeof path !== "string") return;
    await host.installExtension(
      await readCommunityExtension(path, development),
      development ? path : undefined,
    );
  };
  return (
    <motion.section
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="space-y-4 border-t pt-6"
      aria-label="Community Extensions"
    >
      <h2 className="text-lg font-semibold">Community Extensions</h2>
      <p className="text-sm text-muted-foreground">
        Installiere ein Paket oder lade einen lokalen Entwicklungsordner. Prüfe Herausgeber und
        Berechtigungen vor der Aktivierung. Die Deinstallation löscht auch den eigenen
        Extension-Speicher.
      </p>
      <fieldset disabled={pending} className="space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run(() => install(false))}>
            Paket installieren
          </Button>
          <Button size="sm" variant="outline" onClick={() => run(() => install(true))}>
            Entwicklungsordner laden
          </Button>
        </div>
        {host.listExtensions().map((extension) => (
          <CommunityExtensionCard
            key={extension.archive.manifest.id}
            extension={extension}
            run={run}
          />
        ))}
      </fieldset>
      {!host.listExtensions().length && (
        <p className="text-sm text-muted-foreground">Keine Community Extensions installiert.</p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Extension-Logs ({host.logs.length})</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs select-text">
          {host.logs
            .map(
              (entry) => `${entry.time} [extension:${entry.id}] ${entry.level}: ${entry.message}`,
            )
            .join("\n")}
        </pre>
      </details>
    </motion.section>
  );
}
