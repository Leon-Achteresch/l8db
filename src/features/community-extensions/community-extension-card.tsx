import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDownIcon, KeyRoundIcon, type LucideIcon, PuzzleIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readCommunityExtension } from "@/lib/db";
import { SPRING_LAYOUT, SPRING_PANEL } from "@/lib/ease";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { cn } from "@/lib/utils";
import { ExtensionActionsMenu } from "./extension-actions-menu";
import { ExtensionDetails } from "./extension-details";
import { ExtensionPermissionConsent } from "./extension-permission-consent";
import { PASSWORD_MANAGER_ID } from "./password-manager";
import { PasswordManagerSetup } from "./password-manager-setup";

const GUIDED: Record<
  string,
  { icon: LucideIcon; setup: ComponentType<{ extension: ExtensionDescriptor }> }
> = {
  [PASSWORD_MANAGER_ID]: { icon: KeyRoundIcon, setup: PasswordManagerSetup },
};

const reveal = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: SPRING_PANEL,
};

export function CommunityExtensionCard({
  extension,
  run,
}: {
  extension: ExtensionDescriptor;
  run: (action: () => Promise<unknown>) => void;
}) {
  const host = useExtensionHost();
  const { manifest } = extension.archive;
  const id = manifest.id;
  const guided = GUIDED[id];
  const Icon = guided?.icon ?? PuzzleIcon;
  const Setup = guided?.setup;
  const [consent, setConsent] = useState(false);
  const [details, setDetails] = useState(false);
  const failed = extension.state === "failed";

  const activate = () => {
    if (manifest.permissions?.length) setConsent(true);
    else run(() => host.enableExtension(id, []));
  };

  const update = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "l8db Extension", extensions: ["l8db-extension"] }],
    });
    if (typeof path === "string")
      await host.updateExtension(await readCommunityExtension(path, false));
  };

  const reload = async () =>
    host.reloadExtension(
      id,
      extension.developmentPath
        ? await readCommunityExtension(extension.developmentPath, true)
        : undefined,
    );

  return (
    <motion.article
      layout
      transition={{ layout: SPRING_LAYOUT }}
      aria-label={manifest.name}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs"
    >
      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
            extension.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{manifest.name}</h3>
            <Badge variant={failed ? "destructive" : extension.enabled ? "secondary" : "outline"}>
              {failed ? "Fehler" : extension.enabled ? "Aktiv" : "Inaktiv"}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">v{manifest.version}</span>
          </div>
          <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{manifest.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!extension.enabled && !consent && (
            <Button size="sm" onClick={activate}>
              Aktivieren
            </Button>
          )}
          <ExtensionActionsMenu
            extension={extension}
            onDisable={() => run(() => host.disableExtension(id))}
            onReload={() => run(reload)}
            onUpdate={() => run(update)}
            onUninstall={() => run(() => host.uninstallExtension(id))}
          />
        </div>
      </div>

      {extension.error && (
        <div className="px-4 pb-4">
          <Alert variant="destructive">
            <AlertDescription className="break-all">{extension.error}</AlertDescription>
          </Alert>
        </div>
      )}

      <AnimatePresence initial={false}>
        {consent && !extension.enabled && (
          <motion.div {...reveal} className="overflow-hidden">
            <div className="space-y-3 border-t bg-muted/30 px-4 py-4">
              <p className="text-xs">
                <span className="font-medium">{manifest.name}</span> von {manifest.publisher}{" "}
                benötigt folgende Freigaben:
              </p>
              <ExtensionPermissionConsent
                extension={extension}
                confirmLabel="Erlauben und aktivieren"
                onCancel={() => setConsent(false)}
                onConfirm={(grants) =>
                  run(async () => {
                    await host.enableExtension(id, grants);
                    setConsent(false);
                  })
                }
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {Setup && extension.enabled && (
        <div className="border-t px-4 py-4">
          <Setup extension={extension} />
        </div>
      )}

      <div className="border-t">
        <button
          type="button"
          aria-expanded={details}
          onClick={() => setDetails((value) => !value)}
          className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform duration-200", details && "rotate-180")}
          />
          Details
        </button>
        <AnimatePresence initial={false}>
          {details && (
            <motion.div {...reveal} className="overflow-hidden">
              <div className="px-4 pb-4">
                <ExtensionDetails extension={extension} guided={!!Setup} run={run} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}
