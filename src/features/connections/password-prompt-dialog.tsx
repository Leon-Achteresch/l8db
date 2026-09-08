import { useState } from "react";
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
  const resolve = usePasswordPrompt((state) => state.resolve);
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(false);

  function finish(answer: { password: string; save: boolean } | null) {
    resolve?.(answer);
    setPassword("");
    setSave(false);
  }

  return (
    <Dialog open={connection !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent className="sm:max-w-sm">
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
              Für „{connection?.name}“ ist kein Passwort hinterlegt.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="prompt-password">Passwort</Label>
              <Input
                id="prompt-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="prompt-save"
                checked={save}
                onCheckedChange={(value) => setSave(value === true)}
              />
              <Label htmlFor="prompt-save">Passwort speichern</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Abbrechen
            </Button>
            <Button type="submit">Verbinden</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
