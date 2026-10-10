import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { DML_PREVIEW_MODES, type DmlPreviewMode } from "@/lib/dml-preview/mode";
import { type SslDefaultMode, useSettingsStore } from "@/lib/settings";

export function SettingsSecurityTab() {
  const {
    sshTrustNewHosts,
    connectionTimeout,
    sslDefaultMode,
    productionReadOnly,
    productionConfirmCommit,
    productionAutoRollback,
    setProductionReadOnly,
    setProductionConfirmCommit,
    setProductionAutoRollback,
    dmlPreviewMode,
    dmlPreviewRowLimit,
    dmlPreviewTimeout,
    dmlPreviewWarnThreshold,
    setDmlPreviewMode,
    setDmlPreviewRowLimit,
    setDmlPreviewTimeout,
    setDmlPreviewWarnThreshold,
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
        <SettingsRow settingId="ssh-tofu">
          <Switch
            checked={sshTrustNewHosts}
            onCheckedChange={setSshTrustNewHosts}
            aria-label="Neue SSH-Host-Keys akzeptieren"
          />
        </SettingsRow>

        <SettingsRow settingId="production-read-only">
          <Switch
            checked={productionReadOnly}
            onCheckedChange={setProductionReadOnly}
            aria-label="Produktion standardmäßig schreibgeschützt öffnen"
          />
        </SettingsRow>

        <SettingsRow settingId="production-commit">
          <Switch
            checked={productionConfirmCommit}
            onCheckedChange={setProductionConfirmCommit}
            aria-label="Commits auf Produktion bestätigen"
          />
        </SettingsRow>

        <SettingsRow settingId="production-auto-rollback">
          <Switch
            checked={productionAutoRollback}
            onCheckedChange={setProductionAutoRollback}
            aria-label="Offene Produktions-Transaktionen automatisch zurückrollen"
          />
        </SettingsRow>

        <SettingsRow settingId="dml-preview">
          <SegmentedControl
            value={dmlPreviewMode}
            onChange={(value) => setDmlPreviewMode(value as DmlPreviewMode)}
            label="Vorschau vor UPDATE und DELETE"
            options={DML_PREVIEW_MODES}
          />
        </SettingsRow>

        <SettingsRow settingId="dml-preview-limits">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Input
                type="number"
                min={10}
                max={1000}
                step={1}
                aria-label="Beispielzeilen der Vorschau"
                value={dmlPreviewRowLimit}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (!Number.isNaN(value) && value >= 10 && value <= 1000)
                    setDmlPreviewRowLimit(value);
                }}
                className="h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              Zeilen
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Input
                type="number"
                min={5}
                max={60}
                step={1}
                aria-label="Zeitlimit der Vorschau"
                value={dmlPreviewTimeout}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (!Number.isNaN(value) && value >= 5 && value <= 60)
                    setDmlPreviewTimeout(value);
                }}
                className="h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              Sekunden
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Input
                type="number"
                min={1}
                max={10000000}
                step={1}
                aria-label="Warnschwelle betroffener Zeilen"
                value={dmlPreviewWarnThreshold}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (!Number.isNaN(value) && value >= 1 && value <= 10000000)
                    setDmlPreviewWarnThreshold(value);
                }}
                className="h-8 w-24 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              Warnung ab
            </span>
          </div>
        </SettingsRow>

        <SettingsRow settingId="conn-timeout">
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

        <SettingsRow settingId="ssl-mode">
          <SegmentedControl
            value={sslDefaultMode}
            onChange={(val) => setSslDefaultMode(val as SslDefaultMode)}
            label="Standard SSL Modus"
            options={[
              { value: "prefer", label: "Bevorzugen" },
              { value: "require", label: "Erzwingen" },
              { value: "disable", label: "Deaktiviert" },
              { value: "verify-full", label: "Zertifikat prüfen" },
            ]}
          />
        </SettingsRow>

        <div
          data-setting-id="keychain"
          tabIndex={-1}
          className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"
        >
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
