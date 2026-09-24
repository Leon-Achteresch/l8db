import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePasswordPrompt } from "@/lib/password-prompt";

export function PasswordPromptDialog() {
  const connection = usePasswordPrompt((state) => state.connection);
  const message = usePasswordPrompt((state) => state.message);
  const resolve = usePasswordPrompt((state) => state.resolve);
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!connection) return;
    setPassword("");
    setSave(Boolean(message));
  }, [connection, message]);

  function finish(answer: { password: string; save: boolean } | null) {
    resolve?.(answer);
    setPassword("");
    setSave(false);
  }

  return (
    <Dialog open={connection !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent
        className="z-[120] sm:max-w-md"
        overlayClassName="z-[120]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          passwordRef.current?.focus();
        }}
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            finish({ password, save });
          }}
        >
          <DialogHeader>
            <DialogTitle>Passwort erforderlich</DialogTitle>
            <DialogDescription>
              {message
                ? `Das gespeicherte Passwort für „${connection?.name}“ wurde abgelehnt.`
                : `Für „${connection?.name}“ ist kein Passwort hinterlegt.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="prompt-password">Passwort</Label>
              <Input
                ref={passwordRef}
                id="prompt-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="prompt-save"
                tabIndex={0}
                checked={save}
                onCheckedChange={(value) => setSave(value === true)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  setSave((value) => !value);
                }}
              />
              <Label htmlFor="prompt-save">Passwort speichern</Label>
            </div>
            {message && (
              <p className="whitespace-pre-wrap break-words text-destructive text-sm">{message}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" tabIndex={0} variant="outline" onClick={() => finish(null)}>
              Abbrechen
            </Button>
            <Button type="submit" tabIndex={0}>
              Verbinden
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
