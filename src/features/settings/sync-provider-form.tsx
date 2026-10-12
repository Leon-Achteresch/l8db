import { CheckIcon, PlugZapIcon, TriangleAlertIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SyncSecretField } from "@/features/settings/sync-secret-field";
import { SYNC_GITHUB_ACCOUNT, SYNC_WEBDAV_ACCOUNT, syncTest } from "@/lib/db/sync";
import { errorMessage } from "@/lib/sync/controller";
import {
  type SyncConfig,
  syncTarget,
  type TargetField,
  targetChangeNeedsConfirmation,
  targetKey,
  useSyncStore,
} from "@/lib/sync/store";

type ProviderChoice = "off" | "webdav" | "gist";
type Draft = Pick<SyncConfig, TargetField>;

export function SyncProviderForm() {
  const state = useSyncStore();
  const committed: Draft = {
    provider: state.provider,
    webdavUrl: state.webdavUrl,
    webdavPath: state.webdavPath,
    gistId: state.gistId,
  };
  const committedKey = targetKey(committed);
  const [draft, setDraft] = useState<Draft>(committed);
  const [pending, setPending] = useState<Draft | null>(null);
  const [testing, setTesting] = useState(false);
  const dirty = targetKey(draft) !== committedKey;
  const choice: ProviderChoice = draft.provider ?? "off";
  const insecure = /^http:\/\//i.test(draft.webdavUrl.trim());
  const target = syncTarget(state);
  const commit = (next: Draft) => {
    if (targetChangeNeedsConfirmation(state, next)) setPending(next);
    else state.commitTarget(next);
  };
  const test = async () => {
    if (!target) return;
    setTesting(true);
    try {
      toast.success(await syncTest(target, `sync-test-${Date.now()}`));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };
  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const onEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter" && dirty) commit(draft);
  };
  return (
    <div className="space-y-3">
      <div className="w-full max-w-sm">
        <SegmentedControl
          value={choice}
          label="Sync-Anbieter"
          onChange={(value) => {
            const next = { ...draft, provider: value === "off" ? null : value };
            setDraft(next);
            if (value === "off" || targetKey(next) !== committedKey) commit(next);
          }}
          options={[
            { value: "off", label: "Aus" },
            { value: "webdav", label: "WebDAV" },
            { value: "gist", label: "GitHub Gist" },
          ]}
        />
      </div>
      {draft.provider === "webdav" && (
        <div className="grid gap-2 @min-[38rem]:grid-cols-2">
          <Input
            aria-label="WebDAV-URL"
            placeholder="https://cloud.example.com/remote.php/dav/files/benutzer"
            value={draft.webdavUrl}
            onChange={(event) => edit({ webdavUrl: event.target.value })}
            onKeyDown={onEnter}
            className="h-8 text-xs @min-[38rem]:col-span-2"
          />
          <Input
            aria-label="WebDAV-Benutzer"
            placeholder="Benutzername"
            value={state.webdavUser}
            onChange={(event) => state.configure({ webdavUser: event.target.value })}
            className="h-8 text-xs"
          />
          <Input
            aria-label="Dateipfad auf dem Server"
            placeholder="/l8db/l8db-sync.json"
            value={draft.webdavPath}
            onChange={(event) => edit({ webdavPath: event.target.value })}
            onKeyDown={onEnter}
            className="h-8 text-xs"
          />
          <div className="@min-[38rem]:col-span-2">
            <SyncSecretField
              kind="webdav"
              account={SYNC_WEBDAV_ACCOUNT}
              label="WebDAV-Passwort"
              placeholder="Passwort oder App-Passwort"
            />
          </div>
          {insecure && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs @min-[38rem]:col-span-2">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="flex-1 space-y-2">
                <p>
                  Die URL nutzt unverschlüsseltes HTTP. Passwort und Sync-Daten wären im Netzwerk
                  lesbar. Nutzen Sie nach Möglichkeit HTTPS.
                </p>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.webdavAllowInsecure}
                    onCheckedChange={(checked) => state.configure({ webdavAllowInsecure: checked })}
                    aria-label="Unverschlüsseltes HTTP erlauben"
                  />
                  <span>Unverschlüsseltes HTTP trotzdem erlauben</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {draft.provider === "gist" && (
        <div className="space-y-2">
          <SyncSecretField
            kind="github"
            account={SYNC_GITHUB_ACCOUNT}
            label="GitHub-Token"
            placeholder="Personal Access Token mit Scope „gist“"
          />
          <Input
            aria-label="Gist-ID"
            placeholder="Bestehende Gist-ID (leer lassen für neuen Secret Gist)"
            value={draft.gistId}
            onChange={(event) => edit({ gistId: event.target.value })}
            onKeyDown={onEnter}
            className="h-8 w-full max-w-sm text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Secret Gists sind nur nicht gelistet, aber nicht privat: Wer die Adresse kennt, kann sie
            lesen. Aktivieren Sie deshalb die vollständige Verschlüsselung, wenn die Daten
            vertraulich sind. GitHub bietet für Gists keine atomaren Schreibbedingungen: l8db prüft
            die Gist-Version direkt vor dem Speichern, ein Schreibzugriff eines anderen Rechners in
            den Millisekunden dazwischen kann trotzdem überschrieben werden. Ältere Stände bleiben
            in der Revisionshistorie des Gists erhalten.
          </p>
        </div>
      )}
      {draft.provider && (
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button size="sm" onClick={() => commit(draft)}>
              <CheckIcon className="size-3.5" />
              Übernehmen
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={dirty || !target || testing || (insecure && !state.webdavAllowInsecure)}
            onClick={() => void test()}
          >
            <PlugZapIcon className="size-3.5" />
            Verbindung testen
          </Button>
        </div>
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setDraft(committed);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync-Ziel ändern</DialogTitle>
            <DialogDescription>
              Mit einem anderen Anbieter, Server oder Dateipfad beginnt der Abgleich neu. Die erste
              Synchronisierung mit dem neuen Ziel kann Konflikte für alle abweichenden Einträge
              melden. Lokale Daten bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null);
                setDraft(committed);
              }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                if (pending) state.commitTarget(pending);
                setPending(null);
              }}
            >
              Ziel ändern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
