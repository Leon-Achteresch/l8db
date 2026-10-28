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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type SupabaseAuthUserDetail,
  supabaseStudioAuthCreateUser,
} from "@/lib/db/supabase-studio-auth";
import { parseJsonObject } from "./supabase-auth-format";
import { SupabaseAuthJsonField } from "./supabase-auth-json-field";

interface Props {
  reference: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: SupabaseAuthUserDetail) => void;
}

export function SupabaseAuthCreateDialog({ reference, open, onOpenChange, onCreated }: Props) {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [userMetadata, setUserMetadata] = useState("{}");
  const [appMetadata, setAppMetadata] = useState("{}");
  const [busy, setBusy] = useState(false);
  const user = parseJsonObject(userMetadata);
  const app = parseJsonObject(appMetadata);

  async function submit() {
    if (typeof user === "string" || typeof app === "string") return;
    setBusy(true);
    try {
      const created = await supabaseStudioAuthCreateUser(reference, {
        [mode]: identifier.trim(),
        password: password || undefined,
        [mode === "email" ? "email_confirm" : "phone_confirm"]: autoConfirm,
        user_metadata: Object.keys(user).length ? user : undefined,
        app_metadata: Object.keys(app).length ? app : undefined,
      });
      toast.success("Benutzer erstellt.");
      setIdentifier("");
      setPassword("");
      setUserMetadata("{}");
      setAppMetadata("{}");
      onCreated(created);
      onOpenChange(false);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Benutzer erstellen</DialogTitle>
          <DialogDescription>
            Legt einen Benutzer über die Auth-Admin-API an. Ohne Passwort kann sich der Benutzer per
            Magic Link oder OTP anmelden.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-auth-create"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Tabs value={mode} onValueChange={(value) => setMode(value as "email" | "phone")}>
            <TabsList className="h-8">
              <TabsTrigger value="email" className="text-xs">
                E-Mail
              </TabsTrigger>
              <TabsTrigger value="phone" className="text-xs">
                Telefon
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-create-identifier" className="text-xs">
              {mode === "email" ? "E-Mail-Adresse" : "Telefonnummer (E.164)"}
            </Label>
            <Input
              id="supabase-auth-create-identifier"
              type={mode === "email" ? "email" : "tel"}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={mode === "email" ? "name@example.com" : "+491511234567"}
              required
              disabled={busy}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supabase-auth-create-password" className="text-xs">
              Passwort (optional)
            </Label>
            <Input
              id="supabase-auth-create-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="supabase-auth-create-confirm" className="text-xs">
              {mode === "email"
                ? "E-Mail automatisch bestätigen"
                : "Telefon automatisch bestätigen"}
            </Label>
            <Switch
              id="supabase-auth-create-confirm"
              checked={autoConfirm}
              onCheckedChange={setAutoConfirm}
              disabled={busy}
            />
          </div>
          <SupabaseAuthJsonField
            id="supabase-auth-create-user-metadata"
            label="user_metadata"
            value={userMetadata}
            onChange={setUserMetadata}
            disabled={busy}
          />
          <SupabaseAuthJsonField
            id="supabase-auth-create-app-metadata"
            label="app_metadata"
            value={appMetadata}
            onChange={setAppMetadata}
            disabled={busy}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            form="supabase-auth-create"
            disabled={busy || typeof user === "string" || typeof app === "string"}
          >
            {busy ? "Erstellt…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
