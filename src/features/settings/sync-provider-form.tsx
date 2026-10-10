import { PlugZapIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SyncSecretField } from "@/features/settings/sync-secret-field";
import { SYNC_GITHUB_ACCOUNT, SYNC_WEBDAV_ACCOUNT, syncTest } from "@/lib/db/sync";
import { errorMessage } from "@/lib/sync/controller";
import { syncTarget, useSyncStore } from "@/lib/sync/store";

type ProviderChoice = "off" | "webdav" | "gist";

export function SyncProviderForm() {
  const state = useSyncStore();
  const [testing, setTesting] = useState(false);
  const choice: ProviderChoice = state.provider ?? "off";
  const insecure = /^http:\/\//i.test(state.webdavUrl.trim());
  const target = syncTarget(state);
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
  return (
    <div className="space-y-3">
      <div className="w-full max-w-sm">
        <SegmentedControl
          value={choice}
          label="Sync-Anbieter"
          onChange={(value) => state.configure({ provider: value === "off" ? null : value })}
          options={[
            { value: "off", label: "Aus" },
            { value: "webdav", label: "WebDAV" },
            { value: "gist", label: "GitHub Gist" },
          ]}
        />
      </div>
      {state.provider === "webdav" && (
        <div className="grid gap-2 @min-[38rem]:grid-cols-2">
          <Input
            aria-label="WebDAV-URL"
            placeholder="https://cloud.example.com/remote.php/dav/files/benutzer"
            value={state.webdavUrl}
            onChange={(event) => state.configure({ webdavUrl: event.target.value })}
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
            value={state.webdavPath}
            onChange={(event) => state.configure({ webdavPath: event.target.value })}
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
      {state.provider === "gist" && (
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
            value={state.gistId}
            onChange={(event) => state.configure({ gistId: event.target.value })}
            className="h-8 w-full max-w-sm text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Secret Gists sind nur nicht gelistet, aber nicht privat: Wer die Adresse kennt, kann sie
            lesen. Aktivieren Sie deshalb die vollständige Verschlüsselung, wenn die Daten
            vertraulich sind.
          </p>
        </div>
      )}
      {state.provider && (
        <Button
          size="sm"
          variant="outline"
          disabled={!target || testing || (insecure && !state.webdavAllowInsecure)}
          onClick={() => void test()}
        >
          <PlugZapIcon className="size-3.5" />
          Verbindung testen
        </Button>
      )}
    </div>
  );
}
