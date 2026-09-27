import { ChevronDownIcon, EyeIcon, KeyRoundIcon, RefreshCwIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { cn } from "@/lib/utils";
import {
  errorText,
  type VAULT_PROVIDERS,
  type VaultSyncResult,
  vaultSync,
} from "./password-manager";
import { VaultManualEntry } from "./vault-manual-entry";

function summary(result: VaultSyncResult, name: string) {
  if (!result.total && !result.removed && !result.hidden && !result.skipped.length)
    return `In ${name} sind noch keine Datenbank-Zugänge für l8db hinterlegt.`;
  const changes = [
    result.added && `${result.added} neu`,
    result.removed && `${result.removed} entfernt`,
    result.hidden && `${result.hidden} ausgeblendet`,
  ].filter(Boolean);
  return `${result.total === 1 ? "1 Datenbank-Zugang ist" : `${result.total} Datenbank-Zugänge sind`} in l8db verfügbar${changes.length ? ` (${changes.join(", ")})` : ""}.`;
}

export function VaultReadyPanel({
  extension,
  provider,
  autoStart,
}: {
  extension: ExtensionDescriptor;
  provider: (typeof VAULT_PROVIDERS)[number];
  autoStart: boolean;
}) {
  const host = useExtensionHost();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<VaultSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const started = useRef(false);
  const autoSyncId = useId();
  const autoSync = extension.configuration["vault.autoSync"] !== false;

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      setResult(await vaultSync(host));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSyncing(false);
    }
  }, [host]);

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void sync();
  }, [autoStart, sync]);

  const setAutoSync = (next: boolean) =>
    void host
      .setConfiguration(extension.archive.manifest.id, {
        ...extension.configuration,
        "vault.autoSync": next,
      })
      .catch((cause) => toast.error(errorText(cause)));

  const run = (command: string) =>
    void host
      .executeCommand(command)
      .then(() => sync())
      .catch((cause) => toast.error(errorText(cause)));

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Zugänge erhalten</p>
            <p
              aria-live="polite"
              className={cn(
                "text-xs text-pretty",
                error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {syncing
                ? `Lade Datenbank-Zugänge aus ${provider.name} …`
                : error
                  ? error
                  : result
                    ? summary(result, provider.name)
                    : `Alle Einträge in ${provider.name}, deren Name mit „l8db:“ beginnt, erscheinen automatisch als Verbindung in l8db, auch aus geteilten Bereichen deines Teams.`}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
            {syncing ? <Spinner /> : <RefreshCwIcon />}
            Jetzt abgleichen
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <label htmlFor={autoSyncId}>Beim Start von l8db automatisch abgleichen</label>
          <Switch id={autoSyncId} checked={autoSync} onCheckedChange={setAutoSync} />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <KeyRoundIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Verbindungen in {provider.name} speichern</p>
            <p className="text-xs text-pretty text-muted-foreground">
              Beim Anlegen oder Bearbeiten einer Verbindung entscheidest du per Häkchen, ob sie in{" "}
              {provider.name} landet. Entfernst du eine Verbindung in l8db, wird sie nur
              ausgeblendet, in {provider.name} bleibt sie erhalten.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => run("vault.export")}>
            <UploadIcon />
            Bestehende übernehmen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run("vault.import")}>
            <EyeIcon />
            Ausgeblendete einblenden
          </Button>
        </div>
        <Collapsible open={guide} onOpenChange={setGuide}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform duration-200", guide && "rotate-180")}
            />
            Eintrag direkt in {provider.name} anlegen
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <VaultManualEntry provider={provider} />
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}
