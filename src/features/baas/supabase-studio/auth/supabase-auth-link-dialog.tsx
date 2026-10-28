import { Copy } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyWithToast } from "@/lib/clipboard";
import {
  type SupabaseAuthLink,
  type SupabaseAuthLinkType,
  supabaseStudioAuthGenerateLink,
} from "@/lib/db/supabase-studio-auth";

const LINK_TYPES: { value: SupabaseAuthLinkType; label: string }[] = [
  { value: "magiclink", label: "Magic Link" },
  { value: "recovery", label: "Passwort zurücksetzen" },
  { value: "invite", label: "Einladung" },
  { value: "signup", label: "Registrierung" },
  { value: "email_change_current", label: "E-Mail-Änderung (aktuelle Adresse)" },
  { value: "email_change_new", label: "E-Mail-Änderung (neue Adresse)" },
];

interface Props {
  reference: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onGenerated: () => void;
}

export function SupabaseAuthLinkDialog({
  reference,
  open,
  onOpenChange,
  email: initialEmail,
  onGenerated,
}: Props) {
  const [kind, setKind] = useState<SupabaseAuthLinkType>("magiclink");
  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [redirectTo, setRedirectTo] = useState("");
  const [result, setResult] = useState<SupabaseAuthLink | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      setResult(
        await supabaseStudioAuthGenerateLink(
          reference,
          kind,
          email.trim(),
          newEmail.trim(),
          password,
          redirectTo.trim(),
          null,
        ),
      );
      onGenerated();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const fields: [string, string | null][] = result
    ? [
        ["Link", result.action_link],
        ["E-Mail-OTP", result.email_otp],
        ["Token-Hash", result.hashed_token],
        ["Verifizierungstyp", result.verification_type],
        ["Weiterleitung", result.redirect_to],
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link erzeugen</DialogTitle>
          <DialogDescription>
            Erzeugt einen Auth-Link, ohne eine E-Mail zu senden. Registrierung und Einladung legen
            den Benutzer an, falls er noch nicht existiert.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-auth-link"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label className="text-xs">Typ</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as SupabaseAuthLinkType);
                setResult(null);
              }}
            >
              <SelectTrigger size="sm" aria-label="Link-Typ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-link-email" className="text-xs">
              E-Mail-Adresse
            </Label>
            <Input
              id="supabase-auth-link-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          {kind.startsWith("email_change") && (
            <div className="grid gap-1.5">
              <Label htmlFor="supabase-auth-link-new-email" className="text-xs">
                Neue E-Mail-Adresse
              </Label>
              <Input
                id="supabase-auth-link-new-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                disabled={busy}
              />
            </div>
          )}
          {kind === "signup" && (
            <div className="grid gap-1.5">
              <Label htmlFor="supabase-auth-link-password" className="text-xs">
                Passwort
              </Label>
              <Input
                id="supabase-auth-link-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
                disabled={busy}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-link-redirect" className="text-xs">
              Weiterleitungs-URL (optional)
            </Label>
            <Input
              id="supabase-auth-link-redirect"
              type="url"
              value={redirectTo}
              onChange={(event) => setRedirectTo(event.target.value)}
              disabled={busy}
            />
          </div>
        </form>
        {fields.some(([, value]) => value) && (
          <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
            {fields
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 font-mono break-all">{value}</dd>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${label} kopieren`}
                    onClick={() => void copyWithToast(value ?? "", label)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              ))}
          </dl>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Schließen
          </Button>
          <Button type="submit" form="supabase-auth-link" disabled={busy}>
            {busy ? "Erzeugt…" : "Link erzeugen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
