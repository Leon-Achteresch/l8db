import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { SyncSecretField } from "@/features/settings/sync-secret-field";
import { SYNC_PASSPHRASE_ACCOUNT } from "@/lib/db/sync";
import { useSyncStore } from "@/lib/sync/store";

export function SyncSecurityRow() {
  const includeSecrets = useSyncStore((state) => state.includeSecrets);
  const encryptAll = useSyncStore((state) => state.encryptAll);
  const passphraseStored = useSyncStore((state) => state.storedSecrets.passphrase);
  const configure = useSyncStore((state) => state.configure);
  return (
    <SettingsRow settingId="sync-secrets" stacked>
      <div className="space-y-3 text-xs">
        <SyncSecretField
          kind="passphrase"
          account={SYNC_PASSPHRASE_ACCOUNT}
          label="Sync-Passphrase"
          placeholder="Eigene Sync-Passphrase (mind. 12 Zeichen)"
          minLength={12}
        />
        <p className="text-muted-foreground">
          Die Passphrase wird nur im Schlüsselbund dieses Rechners gespeichert und nie übertragen.
          Geht sie verloren, lassen sich verschlüsselte Sync-Daten nicht wiederherstellen. Auf jedem
          Rechner muss dieselbe Passphrase hinterlegt werden.
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={includeSecrets}
            disabled={!passphraseStored && !includeSecrets}
            onCheckedChange={(checked) => configure({ includeSecrets: checked })}
            aria-label="Verbindungspasswörter verschlüsselt mitsynchronisieren"
          />
          <span>Verbindungspasswörter verschlüsselt mitsynchronisieren</span>
        </div>
        {includeSecrets && (
          <div className="flex items-center gap-2">
            <Switch
              checked={encryptAll}
              onCheckedChange={(checked) => configure({ encryptAll: checked })}
              aria-label="Gesamte Sync-Datei verschlüsseln"
            />
            <span>Gesamte Sync-Datei verschlüsseln (empfohlen)</span>
          </div>
        )}
      </div>
    </SettingsRow>
  );
}
