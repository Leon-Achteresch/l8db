import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [askPurge, setAskPurge] = useState(false);
  const disable = (purge: boolean) => {
    configure({ includeSecrets: false, purgeRemoteSecrets: purge });
    setAskPurge(false);
  };
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
          Rechner muss dieselbe Passphrase hinterlegt werden. Beim ersten Abgleich eines Rechners
          übernimmt l8db die Passwörter vom Server.
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={includeSecrets}
            disabled={!passphraseStored && !includeSecrets}
            onCheckedChange={(checked) => {
              if (checked) configure({ includeSecrets: true });
              else setAskPurge(true);
            }}
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
      <Dialog open={askPurge} onOpenChange={setAskPurge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passwörter auch vom Server löschen?</DialogTitle>
            <DialogDescription>
              Auf dem Server liegen möglicherweise noch verschlüsselte Verbindungspasswörter. Beim
              nächsten Hochladen können sie entfernt werden. Andere Rechner mit aktivierter
              Passwort-Synchronisierung laden sie danach erneut hoch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskPurge(false)}>
              Abbrechen
            </Button>
            <Button variant="outline" onClick={() => disable(false)}>
              Auf dem Server behalten
            </Button>
            <Button autoFocus onClick={() => disable(true)}>
              Vom Server löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
