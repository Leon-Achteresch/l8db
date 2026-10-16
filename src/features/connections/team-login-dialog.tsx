import { Building2Icon, LogInIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
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
import { teamCancelLogin } from "@/lib/db/team";
import { useTeamStore } from "@/lib/team/store";
import {
  isLoginCancelled,
  loginTeam,
  MICROSOFT_HUB,
  needsConsent,
  teamErrorText,
} from "@/lib/team/sync";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function TeamLoginDialog() {
  const open = useTeamStore((state) => state.promptOpen);
  const hub = useTeamStore((state) => state.managedHub);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const microsoft = hub === MICROSOFT_HUB;

  const close = () => useTeamStore.setState({ promptOpen: false });

  const login = async (admin = false) => {
    if (!hub) return;
    setWaiting(true);
    setError(null);
    try {
      const result = await loginTeam(hub, admin);
      close();
      toast.success(
        `Angemeldet. ${result?.added ?? 0} Team-Verbindungen wurden für dich eingerichtet.`,
      );
    } catch (failure) {
      if (isLoginCancelled(failure)) return;
      if (useTeamStore.getState().user) {
        close();
        toast.error(`Angemeldet, aber der Abgleich schlug fehl: ${teamErrorText(failure)}`);
      } else setError(failure);
    } finally {
      setWaiting(false);
    }
  };

  return (
    <Dialog
      open={open && hub !== null}
      onOpenChange={(next) => {
        if (next) return;
        if (waiting) void teamCancelLogin();
        close();
      }}
    >
      <DialogContent className="z-[10000004] sm:max-w-md" overlayClassName="z-[10000003]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2Icon className="size-4" />
            Mit Firmenkonto anmelden
          </DialogTitle>
          <DialogDescription>
            Deine Organisation stellt Datenbankverbindungen über{" "}
            {microsoft ? "Microsoft 365" : hub ? hostOf(hub) : "den Team-Hub"} bereit. Nach der
            Anmeldung richtet l8db sie automatisch für dich ein.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {waiting
            ? "Die Anmeldung läuft in deinem Browser. Danach geht es hier automatisch weiter."
            : "Die Anmeldung öffnet sich in deinem Browser. Was du in einer Datenbank darfst, regelt dein Datenbank-Benutzer."}
        </p>
        {error !== null && (
          <p className="whitespace-pre-wrap break-words text-destructive text-sm">
            {teamErrorText(error)}
          </p>
        )}
        <DialogFooter className="sm:flex-wrap">
          {waiting ? (
            <Button variant="outline" onClick={() => void teamCancelLogin()}>
              Abbrechen
            </Button>
          ) : (
            <>
              {microsoft && needsConsent(error) && (
                <Button variant="outline" onClick={() => void login(true)}>
                  <ShieldCheckIcon className="size-3.5" />
                  Für die Organisation freigeben
                </Button>
              )}
              <Button variant="outline" onClick={close}>
                Später
              </Button>
              <Button onClick={() => void login()} autoFocus>
                <LogInIcon className="size-3.5" />
                {microsoft ? "Mit Microsoft anmelden" : "Anmelden"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
