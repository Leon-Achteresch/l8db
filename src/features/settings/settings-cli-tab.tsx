import { Loader2, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tooltip } from "@/components/motion/tooltip";
import { Button } from "@/components/ui/button";
import { CliCommandList } from "@/features/settings/cli-command-list";
import { SettingsRow } from "@/features/settings/settings-row";
import { CLI_CHEATSHEET, CLI_COMPLETIONS } from "@/lib/cli-cheatsheet";
import { useCliPath } from "@/lib/cli-path";
import { type CliState, installCli, uninstallCli } from "@/lib/db/cli";
import { cn } from "@/lib/utils";

const STATE: Record<CliState, { label: string; dot: string }> = {
  ready: { label: "Im PATH", dot: "bg-emerald-500" },
  missing: { label: "Nicht im PATH", dot: "bg-blue-500" },
  not_on_path: { label: "Ordner fehlt im PATH", dot: "bg-blue-500" },
  other: { label: "Anderes l8db im PATH", dot: "bg-amber-500" },
};

export function SettingsCliTab() {
  const status = useCliPath((state) => state.status);
  const error = useCliPath((state) => state.error);
  const refresh = useCliPath((state) => state.refresh);
  const apply = useCliPath((state) => state.apply);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const check = async () => {
    setBusy(true);
    await refresh();
    setBusy(false);
  };

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    try {
      const next = status.installed ? await uninstallCli() : await installCli();
      apply(next);
      const where = next.location ? `${STATE[next.state].label}: ${next.location}` : undefined;
      if (status.installed) {
        if (next.installed) toast.error("„l8db“ ist weiterhin im PATH.", { description: where });
        else toast.success("„l8db“ wurde aus dem PATH entfernt.");
      } else if (next.installed)
        toast.success("„l8db“ ist im PATH.", {
          description: "Neues Terminal öffnen und „l8db --help“ eingeben.",
        });
      else
        toast.error("„l8db“ ist noch nicht erreichbar.", {
          description: where ?? STATE[next.state].label,
        });
    } catch (error) {
      toast.error("Das hat nicht geklappt.", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="@container space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Kommandozeile</h2>

      <div className="space-y-3">
        <SettingsRow
          title="Arbeitsplatz prüfen"
          description="IT-Richtlinie, Team-Datei und Schlüsselbund im Terminal prüfen. Es werden keine Zugangsdaten ausgegeben."
          featureId="settings.cli.doctor"
          stacked
        >
          <div className="w-full">
            <CliCommandList
              examples={[
                {
                  command: "l8db doctor -o json",
                  description: "Konfiguration prüfen; Schlüsselbund bleibt ungeprüft",
                },
                {
                  command: "l8db doctor --test-keychain --strict",
                  description:
                    "Schlüsselbund zusätzlich prüfen und bei offenen Schritten mit Fehlercode enden",
                },
              ]}
            />
          </div>
        </SettingsRow>
        <SettingsRow settingId="cli-install" featureId="settings.cli.install">
          <div className="flex items-center gap-2">
            {status ? (
              <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", STATE[status.state].dot)} />
                {STATE[status.state].label}
              </span>
            ) : null}
            <Tooltip content="Erneut prüfen" side="bottom">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Erneut prüfen"
                disabled={busy}
                onClick={() => void check()}
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              </Button>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              variant={status?.installed ? "ghost" : "default"}
              disabled={!status || busy}
              onClick={() => void toggle()}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : status?.installed ? (
                <Trash2 className="size-3.5" />
              ) : (
                <SquareTerminal className="size-3.5" />
              )}
              {status?.installed ? "Entfernen" : "Zum PATH hinzufügen"}
            </Button>
          </div>
        </SettingsRow>
        {status ? (
          <p className="-mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {status.location
              ? `l8db → ${status.location}`
              : `Ohne PATH: „${status.target}“ direkt aufrufen.`}
          </p>
        ) : error ? (
          <p className="-mt-1 truncate text-xs text-destructive" title={error}>
            Prüfung fehlgeschlagen: {error}
          </p>
        ) : null}

        <SettingsRow settingId="cli-cheatsheet" featureId="settings.cli.tui" stacked>
          <div className="w-full space-y-3">
            {CLI_CHEATSHEET.map((group) => (
              <CliCommandList key={group.title} title={group.title} examples={group.examples} />
            ))}
          </div>
        </SettingsRow>

        <SettingsRow settingId="cli-completions" stacked>
          <div className="w-full">
            <CliCommandList examples={CLI_COMPLETIONS} />
          </div>
        </SettingsRow>
      </div>
    </div>
  );
}
