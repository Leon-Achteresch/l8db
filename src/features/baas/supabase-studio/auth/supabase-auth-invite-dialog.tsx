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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseStudioAuthInvite } from "@/lib/db/supabase-studio-auth";
import { parseJsonObject } from "./supabase-auth-format";
import { SupabaseAuthJsonField } from "./supabase-auth-json-field";

interface Props {
  reference: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}

export function SupabaseAuthInviteDialog({ reference, open, onOpenChange, onInvited }: Props) {
  const [email, setEmail] = useState("");
  const [redirectTo, setRedirectTo] = useState("");
  const [data, setData] = useState("{}");
  const [busy, setBusy] = useState(false);
  const parsed = parseJsonObject(data);

  async function submit() {
    if (typeof parsed === "string") return;
    setBusy(true);
    try {
      await supabaseStudioAuthInvite(
        reference,
        email.trim(),
        redirectTo.trim(),
        Object.keys(parsed).length ? parsed : null,
      );
      toast.success(`Einladung an ${email.trim()} gesendet.`);
      setEmail("");
      onInvited();
      onOpenChange(false);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Benutzer einladen</DialogTitle>
          <DialogDescription>
            Supabase verschickt eine Einladungs-E-Mail über den konfigurierten SMTP-Server.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-auth-invite"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-invite-email" className="text-xs">
              E-Mail-Adresse
            </Label>
            <Input
              id="supabase-auth-invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-invite-redirect" className="text-xs">
              Weiterleitungs-URL (optional)
            </Label>
            <Input
              id="supabase-auth-invite-redirect"
              type="url"
              value={redirectTo}
              onChange={(event) => setRedirectTo(event.target.value)}
              placeholder="https://app.example.com/willkommen"
              disabled={busy}
            />
          </div>
          <SupabaseAuthJsonField
            id="supabase-auth-invite-data"
            label="user_metadata"
            value={data}
            onChange={setData}
            disabled={busy}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            form="supabase-auth-invite"
            disabled={busy || typeof parsed === "string"}
          >
            {busy ? "Sendet…" : "Einladung senden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
