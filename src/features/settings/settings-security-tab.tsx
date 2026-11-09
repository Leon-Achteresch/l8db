import { SegmentedControl } from "@/components/motion/segmented-control";
import { Switch } from "@/components/ui/switch";
import { SecretStorageNotice } from "@/features/connections/secret-storage-notice";
import { SettingsNumberInput } from "@/features/settings/settings-number-input";
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
    dmlPreviewLockTimeout,
    dmlPreviewWarnThreshold,
    setDmlPreviewMode,
    setDmlPreviewRowLimit,
    setDmlPreviewTimeout,
    setDmlPreviewLockTimeout,
    setDmlPreviewWarnThreshold,
    setSshTrustNewHosts,
    setConnectionTimeout,
    setSslDefaultMode,
  } = useSettingsStore();

  return (
    <div className="space-y-4">
      <SecretStorageNotice />
      <h2 className="text-base font-semibold tracking-tight">Sicherheit & Netzwerk</h2>

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
              <SettingsNumberInput
                min={10}
                max={1000}
                step={1}
                aria-label="Beispielzeilen der Vorschau"
                value={dmlPreviewRowLimit}
                onCommit={setDmlPreviewRowLimit}
                className="w-16"
              />
              Zeilen
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SettingsNumberInput
                min={5}
                max={60}
                step={1}
                aria-label="Zeitlimit der Vorschau"
                value={dmlPreviewTimeout}
                onCommit={setDmlPreviewTimeout}
                className="w-16"
              />
              Sekunden
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SettingsNumberInput
                min={1}
                max={30}
                step={1}
                aria-label="Zeitlimit bei offener Transaktion"
                value={dmlPreviewLockTimeout}
                onCommit={setDmlPreviewLockTimeout}
                className="w-16"
              />
              Sekunden bei offener Transaktion
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SettingsNumberInput
                min={1}
                max={10000000}
                step={1}
                aria-label="Warnschwelle betroffener Zeilen"
                value={dmlPreviewWarnThreshold}
                onCommit={setDmlPreviewWarnThreshold}
                className="w-24"
              />
              Warnung ab
            </span>
          </div>
        </SettingsRow>

        <SettingsRow settingId="conn-timeout">
          <div className="flex items-center gap-2">
            <SettingsNumberInput
              min={3}
              max={60}
              step={1}
              aria-label="Verbindungs-Timeout"
              value={connectionTimeout}
              onCommit={setConnectionTimeout}
              className="w-16"
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
              { value: "verify-ca", label: "CA prüfen" },
              { value: "verify-full", label: "Zertifikat prüfen" },
            ]}
          />
        </SettingsRow>

        <div
          data-setting-id="keychain"
          tabIndex={-1}
          className="rounded-xl bg-muted/40 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            OS-Schlüsselbund aktiv
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Passwörter, private SSH-Schlüssel und Tokens liegen verschlüsselt im Schlüsselbund des
            Betriebssystems, nie im Klartext.
          </p>
        </div>
      </div>
    </div>
  );
}
