import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FolderIcon, Share2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectionsStore } from "@/lib/connections";
import { type ShareFolder, teamShareConsent, teamShareFolders } from "@/lib/db/team";
import { shareProblem, shareTeamConnection } from "@/lib/team/share";
import { useTeamStore } from "@/lib/team/store";
import { needsConsent, syncTeam, teamErrorText } from "@/lib/team/sync";

export function TeamShareDialog() {
  const sharing = useTeamStore((state) => state.sharing);
  const connection = useConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === sharing),
  );
  const [folders, setFolders] = useState<ShareFolder[] | null>(null);
  const [folder, setFolder] = useState("root");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ShareFolder | null>(null);

  useEffect(() => {
    if (!sharing) return;
    setFolders(null);
    setFolder("root");
    setError(null);
    setDone(null);
    let current = true;
    void teamShareFolders()
      .then((list) => current && setFolders(list))
      .catch((failure) => current && setError(teamErrorText(failure)));
    return () => {
      current = false;
    };
  }, [sharing]);

  const close = () => useTeamStore.setState({ sharing: null });
  const problem = connection && !done ? shareProblem(connection) : null;

  const share = async (consent = false) => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      if (consent) await teamShareConsent();
      await shareTeamConnection(connection.id, folder);
      setDone(folders?.find((entry) => entry.id === folder) ?? null);
      void syncTeam().catch(() => undefined);
    } catch (failure) {
      setError(teamErrorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={sharing !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2Icon className="size-4" />
            {done ? "Freigegeben" : "Für Team freigeben"}
          </DialogTitle>
          <DialogDescription>
            {done
              ? `„${connection?.name ?? ""}“ liegt jetzt in SharePoint unter „${done.name}“. Wer diesen Ordner lesen darf, bekommt die Verbindung automatisch.`
              : `„${connection?.name ?? ""}“ wird ohne Benutzer und Passwort in SharePoint abgelegt. Jede Person meldet sich mit ihrem eigenen Datenbank-Benutzer an.`}
          </DialogDescription>
        </DialogHeader>
        {!done && (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">Ordner wählen:</p>
            {folders === null && !error && (
              <p className="text-xs text-muted-foreground">Ordner werden geladen…</p>
            )}
            {folders && (
              <div role="radiogroup" aria-label="Ordner" className="grid gap-1">
                {folders.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-muted"
                  >
                    <input
                      type="radio"
                      name="team-share-folder"
                      value={entry.id}
                      checked={folder === entry.id}
                      onChange={() => setFolder(entry.id)}
                      className="accent-primary"
                    />
                    <FolderIcon className="size-3.5 text-muted-foreground" />
                    <span>{entry.name}</span>
                  </label>
                ))}
              </div>
            )}
            {problem && <p className="text-destructive text-sm">{problem}</p>}
          </div>
        )}
        {error && (
          <p className="whitespace-pre-wrap break-words text-destructive text-sm">{error}</p>
        )}
        <DialogFooter className="sm:flex-wrap">
          {done ? (
            <>
              {done.webUrl && (
                <Button variant="outline" onClick={() => void openUrl(done.webUrl)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Zugriff in SharePoint verwalten
                </Button>
              )}
              <Button
                onClick={() => {
                  close();
                  toast.success("Verbindung für das Team freigegeben.");
                }}
              >
                Fertig
              </Button>
            </>
          ) : (
            <>
              {error && needsConsent(error) && (
                <Button variant="outline" disabled={busy} onClick={() => void share(true)}>
                  Als Administrator freigeben
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={close}>
                Abbrechen
              </Button>
              <Button
                disabled={busy || folders === null || problem !== null}
                onClick={() => void share()}
              >
                <Share2Icon className="size-3.5" />
                {busy ? "Wird freigegeben…" : "Freigeben"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
