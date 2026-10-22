import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, KeyRound, Link2, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabaseDeleteAuthUser } from "@/lib/db/supabase";
import type { SupabaseStudioCapabilities } from "@/lib/db/supabase-studio";
import {
  type SupabaseAuthUserAttributes,
  type SupabaseAuthUserDetail,
  supabaseStudioAuthDeleteFactor,
  supabaseStudioAuthSignOutUser,
  supabaseStudioAuthSoftDeleteUser,
  supabaseStudioAuthUpdateUser,
  supabaseStudioAuthUser,
} from "@/lib/db/supabase-studio-auth";
import { formatAuthDate, formatJson, isAuthBanned, parseJsonObject } from "./supabase-auth-format";
import { SupabaseAuthJsonField } from "./supabase-auth-json-field";
import { SupabaseAuthLinkDialog } from "./supabase-auth-link-dialog";

const BAN_DURATIONS = [
  { value: "1h", label: "1 Stunde" },
  { value: "24h", label: "24 Stunden" },
  { value: "168h", label: "7 Tage" },
  { value: "720h", label: "30 Tage" },
  { value: "876000h", label: "Dauerhaft" },
];

type Confirm =
  | { kind: "delete" }
  | { kind: "signout" }
  | { kind: "factor"; id: string; name: string };

interface Props {
  reference: string;
  userId: string | null;
  capabilities: SupabaseStudioCapabilities;
  onClose: () => void;
}

export function SupabaseAuthUserSheet({ reference, userId, capabilities, onClose }: Props) {
  const queryClient = useQueryClient();
  const detailKey = ["supabase", reference, "studio-auth-user", userId];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => supabaseStudioAuthUser(reference, userId ?? ""),
    enabled: userId !== null,
  });
  const user = detail.data;
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [userMetadata, setUserMetadata] = useState<string | null>(null);
  const [appMetadata, setAppMetadata] = useState<string | null>(null);
  const [banDuration, setBanDuration] = useState("24h");
  const [softDelete, setSoftDelete] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailValue = email ?? user?.email ?? "";
  const phoneValue = phone ?? user?.phone ?? "";
  const userMetadataValue = userMetadata ?? formatJson(user?.user_metadata);
  const appMetadataValue = appMetadata ?? formatJson(user?.app_metadata);
  const banned = isAuthBanned(user?.banned_until);

  function refreshList() {
    return queryClient.invalidateQueries({
      queryKey: ["supabase", reference, "studio-auth-users"],
    });
  }

  async function run(action: () => Promise<unknown>, message: string, reload = true) {
    setBusy(true);
    try {
      const result = await action();
      if (result && typeof result === "object" && "id" in result) {
        queryClient.setQueryData(detailKey, result as SupabaseAuthUserDetail);
      } else if (reload) {
        await detail.refetch();
      }
      await refreshList();
      toast.success(message);
      return true;
    } catch (reason) {
      toast.error(String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function update(attributes: SupabaseAuthUserAttributes, message: string) {
    if (!userId) return Promise.resolve(false);
    return run(() => supabaseStudioAuthUpdateUser(reference, userId, attributes), message);
  }

  async function saveProfile() {
    const attributes: SupabaseAuthUserAttributes = {};
    if (emailValue.trim() !== (user?.email ?? "")) attributes.email = emailValue.trim();
    if (phoneValue.trim() !== (user?.phone ?? "")) attributes.phone = phoneValue.trim();
    if (password) attributes.password = password;
    if (Object.keys(attributes).length === 0) {
      toast.info("Keine Änderungen.");
      return;
    }
    if (await update(attributes, "Benutzer gespeichert.")) {
      setEmail(null);
      setPhone(null);
      setPassword("");
    }
  }

  async function saveMetadata(field: "user_metadata" | "app_metadata", text: string) {
    const parsed = parseJsonObject(text);
    if (typeof parsed === "string") return;
    if (await update({ [field]: parsed }, `${field} gespeichert.`)) {
      if (field === "user_metadata") setUserMetadata(null);
      else setAppMetadata(null);
    }
  }

  async function confirmAction() {
    if (!confirm || !userId) return;
    if (confirm.kind === "delete") {
      const done = await run(
        () =>
          softDelete
            ? supabaseStudioAuthSoftDeleteUser(reference, userId)
            : supabaseDeleteAuthUser(reference, userId),
        softDelete ? "Benutzer vorläufig gelöscht." : "Benutzer gelöscht.",
        false,
      );
      setConfirm(null);
      if (done) onClose();
      return;
    }
    if (confirm.kind === "signout") {
      setBusy(true);
      try {
        const result = await supabaseStudioAuthSignOutUser(reference, userId);
        toast.success(
          `${result.sessions} Sitzungen und ${result.refresh_tokens} Refresh-Tokens entfernt.`,
        );
      } catch (reason) {
        toast.error(String(reason));
      } finally {
        setBusy(false);
        setConfirm(null);
      }
      return;
    }
    await run(
      () => supabaseStudioAuthDeleteFactor(reference, userId, confirm.id),
      "MFA-Faktor gelöscht.",
    );
    setConfirm(null);
  }

  const timestamps: [string, string | undefined][] = user
    ? [
        ["Erstellt", user.created_at],
        ["Aktualisiert", user.updated_at],
        ["Letzte Anmeldung", user.last_sign_in_at],
        ["E-Mail bestätigt", user.email_confirmed_at],
        ["Telefon bestätigt", user.phone_confirmed_at],
        ["Eingeladen", user.invited_at],
        ["Bestätigung gesendet", user.confirmation_sent_at],
        ["Wiederherstellung gesendet", user.recovery_sent_at],
        ["Gesperrt bis", user.banned_until],
        ["Gelöscht", user.deleted_at],
      ]
    : [];

  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="truncate">
            {user?.email || user?.phone || userId || "Benutzer"}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px] break-all">{userId}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-6 text-xs">
          {detail.isPending ? (
            <p className="text-muted-foreground">Benutzer wird geladen…</p>
          ) : detail.isError ? (
            <p role="alert" className="text-destructive">
              {String(detail.error)}
            </p>
          ) : user ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{user.role || "authenticated"}</Badge>
                {user.is_anonymous && <Badge variant="secondary">Anonym</Badge>}
                {user.is_sso_user && <Badge variant="secondary">SSO</Badge>}
                {banned && <Badge variant="destructive">Gesperrt</Badge>}
                {user.email && !user.email_confirmed_at && (
                  <Badge variant="outline">E-Mail unbestätigt</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {user.email && !user.email_confirmed_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void update({ email_confirm: true }, "E-Mail bestätigt.")}
                  >
                    <CheckCircle2 className="size-3.5" /> E-Mail bestätigen
                  </Button>
                )}
                {user.phone && !user.phone_confirmed_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void update({ phone_confirm: true }, "Telefon bestätigt.")}
                  >
                    <CheckCircle2 className="size-3.5" /> Telefon bestätigen
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !user.email}
                  title={user.email ? undefined : "Links benötigen eine E-Mail-Adresse."}
                  onClick={() => setLinkOpen(true)}
                >
                  <Link2 className="size-3.5" /> Link erzeugen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !capabilities.sql}
                  title={
                    capabilities.sql
                      ? undefined
                      : "Benötigt SQL-Zugriff (Secret Key selbst gehostet oder Zugangstoken)."
                  }
                  onClick={() => setConfirm({ kind: "signout" })}
                >
                  <LogOut className="size-3.5" /> Alle Sitzungen beenden
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setSoftDelete(false);
                    setConfirm({ kind: "delete" });
                  }}
                >
                  <Trash2 className="size-3.5" /> Löschen
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <Ban className="size-3.5 text-muted-foreground" />
                {banned ? (
                  <>
                    <span className="flex-1">Gesperrt bis {formatAuthDate(user.banned_until)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void update({ ban_duration: "none" }, "Sperre aufgehoben.")}
                    >
                      Entsperren
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1">Benutzer sperren</span>
                    <Select value={banDuration} onValueChange={setBanDuration}>
                      <SelectTrigger size="sm" aria-label="Sperrdauer" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BAN_DURATIONS.map((duration) => (
                          <SelectItem key={duration.value} value={duration.value}>
                            {duration.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void update({ ban_duration: banDuration }, "Benutzer gesperrt.")
                      }
                    >
                      Sperren
                    </Button>
                  </>
                )}
              </div>
              <form
                className="grid gap-3 rounded-lg border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProfile();
                }}
              >
                <p className="font-medium">Zugangsdaten</p>
                <div className="grid gap-1.5">
                  <Label htmlFor="supabase-auth-user-email" className="text-xs">
                    E-Mail-Adresse
                  </Label>
                  <Input
                    id="supabase-auth-user-email"
                    type="email"
                    value={emailValue}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="supabase-auth-user-phone" className="text-xs">
                    Telefonnummer
                  </Label>
                  <Input
                    id="supabase-auth-user-phone"
                    type="tel"
                    value={phoneValue}
                    onChange={(event) => setPhone(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="supabase-auth-user-password" className="text-xs">
                    Neues Passwort
                  </Label>
                  <Input
                    id="supabase-auth-user-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    minLength={6}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <Button size="sm" type="submit" className="justify-self-end" disabled={busy}>
                  <KeyRound className="size-3.5" /> Speichern
                </Button>
              </form>
              <div className="grid gap-2 rounded-lg border p-3">
                <SupabaseAuthJsonField
                  id="supabase-auth-user-metadata"
                  label="user_metadata"
                  value={userMetadataValue}
                  onChange={setUserMetadata}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-self-end"
                  disabled={
                    busy ||
                    userMetadata === null ||
                    typeof parseJsonObject(userMetadataValue) === "string"
                  }
                  onClick={() => void saveMetadata("user_metadata", userMetadataValue)}
                >
                  user_metadata speichern
                </Button>
                <SupabaseAuthJsonField
                  id="supabase-auth-app-metadata"
                  label="app_metadata"
                  value={appMetadataValue}
                  onChange={setAppMetadata}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-self-end"
                  disabled={
                    busy ||
                    appMetadata === null ||
                    typeof parseJsonObject(appMetadataValue) === "string"
                  }
                  onClick={() => void saveMetadata("app_metadata", appMetadataValue)}
                >
                  app_metadata speichern
                </Button>
              </div>
              <div className="grid gap-2">
                <p className="font-medium">Identitäten</p>
                {(user.identities ?? []).length === 0 ? (
                  <p className="text-muted-foreground">Keine Identitäten.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {(user.identities ?? []).map((identity) => (
                      <li
                        key={identity.identity_id ?? `${identity.provider}:${identity.id}`}
                        className="grid gap-0.5 p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{identity.provider}</Badge>
                          <span className="truncate">{identity.email ?? identity.id}</span>
                        </div>
                        <span className="text-muted-foreground">
                          Erstellt {formatAuthDate(identity.created_at)} · Letzte Anmeldung{" "}
                          {formatAuthDate(identity.last_sign_in_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid gap-2">
                <p className="font-medium">MFA-Faktoren</p>
                {(user.factors ?? []).length === 0 ? (
                  <p className="text-muted-foreground">Keine Faktoren registriert.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {(user.factors ?? []).map((factor) => (
                      <li key={factor.id} className="flex items-center gap-2 p-2.5">
                        <div className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate">
                            {factor.friendly_name || factor.factor_type}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {factor.factor_type} · {factor.status} · {factor.id}
                          </span>
                        </div>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Faktor löschen"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              kind: "factor",
                              id: factor.id,
                              name: factor.friendly_name || factor.factor_type,
                            })
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3">
                {timestamps.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5">{formatAuthDate(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </div>
        {linkOpen && user && (
          <SupabaseAuthLinkDialog
            reference={reference}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            email={user.email ?? ""}
            onGenerated={() => void detail.refetch()}
          />
        )}
        <AlertDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && !busy && setConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm?.kind === "delete"
                  ? "Benutzer löschen?"
                  : confirm?.kind === "signout"
                    ? "Alle Sitzungen beenden?"
                    : "MFA-Faktor löschen?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm?.kind === "delete"
                  ? "Der Benutzer wird gelöscht. Eine vorläufige Löschung anonymisiert das Konto und behält die ID für Fremdschlüssel."
                  : confirm?.kind === "signout"
                    ? "Alle Sitzungen und Refresh-Tokens dieses Benutzers werden entfernt. Bereits ausgegebene Access-Tokens bleiben bis zu ihrem Ablauf gültig."
                    : `Faktor ${confirm?.kind === "factor" ? confirm.name : ""} wird entfernt. Der Benutzer muss MFA neu einrichten.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {confirm?.kind === "delete" && (
              <div className="flex items-center gap-2 text-xs">
                <Checkbox
                  id="supabase-auth-soft-delete"
                  checked={softDelete}
                  onCheckedChange={(checked) => setSoftDelete(checked === true)}
                  disabled={busy}
                />
                <Label htmlFor="supabase-auth-soft-delete" className="text-xs">
                  Vorläufig löschen (Soft Delete)
                </Label>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmAction();
                }}
              >
                {busy ? "Läuft…" : "Bestätigen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
