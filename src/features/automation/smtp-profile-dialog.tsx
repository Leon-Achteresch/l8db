import { SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/automation/toast";
import { storeSecret } from "@/lib/db";
import { type SmtpProfile, type SmtpSecurity, testAutomationChannel } from "@/lib/db/automation";

interface Props {
  open: boolean;
  profile: SmtpProfile | null;
  onOpenChange: (open: boolean) => void;
  onSave: (profile: SmtpProfile) => Promise<unknown>;
}

const PORTS: Record<SmtpSecurity, number> = { starttls: 587, tls: 465, none: 25 };

function blank(): SmtpProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "",
    port: 587,
    security: "starttls",
    username: null,
    from: "",
    replyTo: null,
  };
}

export function SmtpProfileDialog({ open, profile, onOpenChange, onSave }: Props) {
  const [draft, setDraft] = useState<SmtpProfile>(blank);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const editing = Boolean(profile);

  useEffect(() => {
    if (!open) return;
    setDraft(profile ? { ...profile } : blank());
    setPassword("");
  }, [open, profile]);

  const patch = (next: Partial<SmtpProfile>) => setDraft((current) => ({ ...current, ...next }));
  const valid = draft.name.trim() && draft.host.trim() && draft.from.trim() && draft.port > 0;

  const persist = async () => {
    const clean: SmtpProfile = {
      ...draft,
      name: draft.name.trim(),
      host: draft.host.trim(),
      from: draft.from.trim(),
      username: draft.username?.trim() || null,
      replyTo: draft.replyTo?.trim() || null,
    };
    if (password) await storeSecret(`automation:smtp:${clean.id}`, password);
    await onSave(clean);
    setPassword("");
    return clean;
  };

  const save = async () => {
    setBusy("save");
    try {
      await persist();
      toast.success(`SMTP-Profil „${draft.name.trim()}“ gespeichert`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const saved = await persist();
      await testAutomationChannel({ type: "email", profileId: saved.id, to: [saved.from], cc: [] });
      toast.success("Test-Mail gesendet", { description: `An ${saved.from}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" data-testid="automation-smtp-dialog">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "SMTP-Profil bearbeiten" : "SMTP-Profil anlegen"}</DialogTitle>
            <DialogDescription>
              Das Passwort liegt im Schlüsselbund des Systems, nicht in den Einstellungen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-6 gap-x-3 gap-y-4">
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label htmlFor="smtp-name">Name</Label>
              <Input
                id="smtp-name"
                value={draft.name}
                placeholder="Firmen-Mail"
                onChange={(event) => patch({ name: event.target.value })}
                autoFocus
              />
            </div>
            <div className="col-span-4 flex flex-col gap-1.5">
              <Label htmlFor="smtp-host">Server</Label>
              <Input
                id="smtp-host"
                value={draft.host}
                placeholder="smtp.example.com"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => patch({ host: event.target.value })}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={(event) => patch({ port: Number(event.target.value) })}
              />
            </div>
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label htmlFor="smtp-security">Verschlüsselung</Label>
              <Select
                value={draft.security}
                onValueChange={(value) => {
                  const security = value as SmtpSecurity;
                  patch({
                    security,
                    port: Object.values(PORTS).includes(draft.port) ? PORTS[security] : draft.port,
                  });
                }}
              >
                <SelectTrigger id="smtp-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starttls">STARTTLS (empfohlen)</SelectItem>
                  <SelectItem value="tls">TLS von Beginn an</SelectItem>
                  <SelectItem value="none">Keine (nur lokale Server)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label htmlFor="smtp-user">Benutzer</Label>
              <Input
                id="smtp-user"
                value={draft.username ?? ""}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label htmlFor="smtp-password">Passwort</Label>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder={editing ? "Unverändert" : ""}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label htmlFor="smtp-from">Absender</Label>
              <Input
                id="smtp-from"
                type="email"
                value={draft.from}
                placeholder="l8db@example.com"
                onChange={(event) => patch({ from: event.target.value })}
              />
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label htmlFor="smtp-reply">Antwort an</Label>
              <Input
                id="smtp-reply"
                type="email"
                value={draft.replyTo ?? ""}
                placeholder="Optional"
                onChange={(event) => patch({ replyTo: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={!valid || Boolean(busy)}
              onClick={() => void test()}
            >
              {busy === "test" ? <Spinner className="size-3.5" /> : <SendIcon />}
              Test-Mail senden
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={!valid || Boolean(busy)}>
                {busy === "save" && <Spinner className="size-3.5" />}
                Speichern
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
