import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore, type SslDefaultMode } from "@/lib/settings";

export function SettingsSecurityTab() {
  const {
    sshTrustNewHosts,
    connectionTimeout,
    sslDefaultMode,
    setSshTrustNewHosts,
    setConnectionTimeout,
    setSslDefaultMode,
  } = useSettingsStore();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Sicherheit & Netzwerk</h2>
        <p className="text-xs text-muted-foreground">
          Verschlüsselung, Host-Validierung und Speicherung vertraulicher Daten.
        </p>
      </div>

      <div className="space-y-3">
        <SettingsRow
          title="Neue SSH-Host-Keys akzeptieren"
          description="Unbekannte Server-Schlüssel beim ersten Verbindungsaufbau automatisch speichern (TOFU)."
        >
          <Switch
            checked={sshTrustNewHosts}
            onCheckedChange={setSshTrustNewHosts}
            aria-label="Neue SSH-Host-Keys akzeptieren"
          />
        </SettingsRow>

        <SettingsRow
          title="Verbindungs-Timeout"
          description="Maximale Wartezeit beim Verbindungsaufbau zur Datenbank (3 bis 60 Sekunden)."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={3}
              max={60}
              step={1}
              aria-label="Verbindungs-Timeout"
              value={connectionTimeout}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 3 && value <= 60) {
                  setConnectionTimeout(value);
                }
              }}
              className="h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-xs text-muted-foreground">Sekunden</span>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Standard-SSL-Modus"
          description="Standardmäßige TLS/SSL-Anforderung für neue Datenbankverbindungen."
        >
          <SegmentedControl
            value={sslDefaultMode}
            onChange={(val) => setSslDefaultMode(val as SslDefaultMode)}
            label="Standard SSL Modus"
            options={[
              { value: "prefer", label: "Bevorzugen" },
              { value: "require", label: "Erzwingen" },
              { value: "disable", label: "Deaktiviert" },
            ]}
          />
        </SettingsRow>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">OS-Schlüsselbund aktiv</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Passwörter, private SSH-Schlüssel und Tokens werden über die native
                Betriebssystem-Keychain verschlüsselt hinterlegt und verbleiben geschützt auf deinem
                Rechner.
              </p>
              <div className="mt-2 flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3 text-emerald-500" /> AES-256 isoliert
                </span>
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="size-3 text-emerald-500" /> Keine Klartextspeicherung
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
