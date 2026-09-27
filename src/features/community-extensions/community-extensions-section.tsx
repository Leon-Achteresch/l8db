import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDownIcon, FolderCodeIcon, PackageIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readCommunityExtension } from "@/lib/db";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { CommunityExtensionCard } from "./community-extension-card";
import { errorText } from "./password-manager";

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
      .catch((error) => toast.error(errorText(error)))
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
  const extensions = host.listExtensions();
  return (
    <motion.section
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="space-y-3"
      aria-labelledby="installed-extensions"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="installed-extensions" className="text-sm font-semibold">
          Installiert
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              Aus Datei installieren
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => run(() => install(false))}>
              <PackageIcon />
              Paket (.l8db-extension)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => install(true))}>
              <FolderCodeIcon />
              Entwicklungsordner
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        {extensions.map((extension) => (
          <CommunityExtensionCard
            key={extension.archive.manifest.id}
            extension={extension}
            run={run}
          />
        ))}
      </fieldset>
      {!extensions.length && (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          Noch keine Erweiterungen installiert. Unter „Entdecken“ findest du offizielle
          Erweiterungen.
        </p>
      )}
      {host.logs.length > 0 && (
        <details className="group text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Protokoll ({host.logs.length})
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-muted/60 p-3 whitespace-pre-wrap break-all select-text">
            {host.logs
              .map(
                (entry) => `${entry.time} [extension:${entry.id}] ${entry.level}: ${entry.message}`,
              )
              .join("\n")}
          </pre>
        </details>
      )}
    </motion.section>
  );
}
