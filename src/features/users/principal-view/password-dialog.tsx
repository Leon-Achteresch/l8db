import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shell/workbench-dialog";
import { useApplyPrincipalChange } from "@/features/users/principal-view/use-apply-principal-change";

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
}

export function PasswordDialog({ open, onOpenChange, name }: PasswordDialogProps) {
  const apply = useApplyPrincipalChange();
  const [password, setPassword] = useState("");
  const [expire, setExpire] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || !password) return;
    setSaving(true);
    const done = await apply({
      kind: "user",
      name,
      action: "alter",
      password,
      expire_password: expire,
    });
    setSaving(false);
    if (!done) return;
    toast.success(`Passwort für ${name} gesetzt`);
    setPassword("");
    onOpenChange(false);
  };

  return (
    <Dialog busy={saving} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Passwort für {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="principal-password" className="text-xs">
              Neues Passwort
            </Label>
            <Input
              id="principal-password"
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && password) save();
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="principal-expire" className="text-[13px]">
              Beim nächsten Login ändern
            </Label>
            <Switch id="principal-expire" size="sm" checked={expire} onCheckedChange={setExpire} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button disabled={!password || saving} onClick={save}>
            {saving && <Spinner />}
            Setzen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
