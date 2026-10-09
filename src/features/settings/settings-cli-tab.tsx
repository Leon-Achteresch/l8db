import { Loader2, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CliCommandList } from "@/features/settings/cli-command-list";
import { SettingsRow } from "@/features/settings/settings-row";
import { CLI_CHEATSHEET, CLI_COMPLETIONS } from "@/lib/cli-cheatsheet";
import { type CliStatus, cliStatus, installCli, uninstallCli } from "@/lib/db/cli";

export function SettingsCliTab() {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    cliStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    try {
      const next = status.installed ? await uninstallCli() : await installCli();
      setStatus(next);
      if (next.installed && !status.installed)
        toast.success("„l8db“ ist jetzt im Terminal verfügbar.", {
          description: "Neues Terminalfenster öffnen und „l8db --help“ eingeben.",
        });
      else if (!next.installed && status.installed) toast.success("„l8db“ wurde entfernt.");
    } catch (error) {
      toast.error("Das hat nicht geklappt.", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="@container space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Kommandozeile</h2>
        <p className="text-xs text-muted-foreground">
          Deine gespeicherten Verbindungen auch im Terminal nutzen: SQL ausführen, Tabellen ansehen,
          Ergebnisse als CSV oder JSON weitergeben.
        </p>
      </div>

      <div className="space-y-3">
        <SettingsRow settingId="cli-install" featureId="settings.cli.install">
          <div className="flex items-center gap-2">
            {status ? (
              <Badge variant={status.installed ? "secondary" : "outline"}>
                {status.installed ? "Installiert" : "Nicht installiert"}
              </Badge>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant={status?.installed ? "outline" : "default"}
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
              {status?.installed ? "Entfernen" : "Installieren"}
            </Button>
          </div>
        </SettingsRow>
        {status ? (
          <p className="-mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {status.installed
              ? `l8db → ${status.location ?? status.target}`
              : `Ohne Installation: „${status.target}“ direkt aufrufen.`}
          </p>
        ) : null}

        <SettingsRow settingId="cli-cheatsheet" stacked>
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
