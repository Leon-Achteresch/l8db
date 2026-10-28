import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SupabaseStudioCapabilities } from "@/lib/db/supabase-studio";
import {
  type SupabaseAuthConfig,
  supabaseStudioAuthConfig,
  supabaseStudioAuthSettings,
  supabaseStudioAuthUpdateConfig,
} from "@/lib/db/supabase-studio-auth";

const GENERAL = [
  "site_url",
  "uri_allow_list",
  "disable_signup",
  "jwt_exp",
  "mailer_autoconfirm",
  "sms_autoconfirm",
  "password_min_length",
  "password_required_characters",
  "external_anonymous_users_enabled",
  "external_email_enabled",
  "external_phone_enabled",
  "refresh_token_rotation_enabled",
  "security_refresh_token_reuse_interval",
  "sessions_timebox",
  "sessions_inactivity_timeout",
  "sessions_single_per_user",
];

const GROUPS: { label: string; match: (key: string) => boolean }[] = [
  { label: "Allgemein", match: (key) => GENERAL.includes(key) },
  { label: "Anbieter", match: (key) => key.startsWith("external_") },
  { label: "Rate Limits", match: (key) => key.startsWith("rate_limit_") },
  { label: "E-Mail & SMTP", match: (key) => /^(mailer_|smtp_)/.test(key) },
  { label: "SMS", match: (key) => key.startsWith("sms_") },
  { label: "MFA", match: (key) => key.startsWith("mfa_") },
  { label: "Hooks", match: (key) => key.startsWith("hook_") },
  { label: "Sicherheit", match: (key) => /^(security_|password_|sessions_)/.test(key) },
  { label: "Weitere", match: () => true },
];

const NUMERIC = /(^rate_limit_|_exp$|_length$|^mfa_max|_interval$|_timebox$|_timeout$|_frequency$)/;
const SECRET = /(secret|_pass$|_password$|_key$|auth_token)/;

function groupOf(key: string) {
  return GROUPS.find((group) => group.match(key))?.label ?? "Weitere";
}

function toPatchValue(key: string, original: SupabaseAuthConfig[string], value: string) {
  if (typeof original === "number" || (original === null && NUMERIC.test(key))) {
    if (value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value === "" && original === null ? null : value;
}

interface Props {
  reference: string;
  capabilities: SupabaseStudioCapabilities;
}

export function SupabaseAuthConfigPanel({ reference, capabilities }: Props) {
  const queryClient = useQueryClient();
  const editable = !capabilities.self_hosted && capabilities.management;
  const settings = useQuery({
    queryKey: ["supabase", reference, "studio-auth-settings"],
    queryFn: () => supabaseStudioAuthSettings(reference),
  });
  const config = useQuery({
    queryKey: ["supabase", reference, "studio-auth-config"],
    queryFn: () => supabaseStudioAuthConfig(reference),
    enabled: editable,
  });
  const [draft, setDraft] = useState<SupabaseAuthConfig>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const enabledProviders = Object.entries(settings.data?.external ?? {})
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider);

  async function save() {
    if (!config.data) return;
    const patch: SupabaseAuthConfig = {};
    for (const [key, value] of Object.entries(draft)) {
      const original = config.data[key];
      patch[key] = typeof value === "string" ? toPatchValue(key, original ?? null, value) : value;
    }
    setBusy(true);
    try {
      const updated = await supabaseStudioAuthUpdateConfig(reference, patch);
      queryClient.setQueryData(["supabase", reference, "studio-auth-config"], updated);
      await queryClient.invalidateQueries({
        queryKey: ["supabase", reference, "studio-auth-settings"],
      });
      setDraft({});
      toast.success("Auth-Konfiguration gespeichert.");
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const keys = Object.keys(config.data ?? {})
    .filter((key) => key.includes(filter.trim().toLowerCase()))
    .sort();
  const changed = Object.keys(draft).length;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-lg border p-3 text-xs">
        <p className="font-medium">Aktive Einstellungen</p>
        {settings.isPending ? (
          <p className="text-muted-foreground">Einstellungen werden geladen…</p>
        ) : settings.isError ? (
          <p role="alert" className="text-destructive">
            {String(settings.error)}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {enabledProviders.length === 0 ? (
                <span className="text-muted-foreground">Keine Anbieter aktiv.</span>
              ) : (
                enabledProviders.map((provider) => (
                  <Badge key={provider} variant="secondary">
                    {provider}
                  </Badge>
                ))
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["Registrierung", settings.data.disable_signup ? "Deaktiviert" : "Erlaubt"],
                  ["E-Mail-Autobestätigung", settings.data.mailer_autoconfirm ? "An" : "Aus"],
                  ["Telefon-Autobestätigung", settings.data.phone_autoconfirm ? "An" : "Aus"],
                  ["SAML", settings.data.saml_enabled ? "An" : "Aus"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
      {capabilities.self_hosted ? (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          Bei selbst gehosteten Instanzen liegt die Auth-Konfiguration in der .env des Docker-Setups
          (z. B. SITE_URL, ADDITIONAL_REDIRECT_URLS, DISABLE_SIGNUP, ENABLE_EMAIL_AUTOCONFIRM,
          JWT_EXPIRY, SMTP_*, GOTRUE_EXTERNAL_*). Nach einer Änderung den auth-Container neu
          starten.
        </p>
      ) : !editable ? (
        <p className="text-xs text-muted-foreground">
          Zum Bearbeiten der Konfiguration wird ein Supabase-Zugangstoken benötigt.
        </p>
      ) : config.isPending ? (
        <p className="text-xs text-muted-foreground">Konfiguration wird geladen…</p>
      ) : config.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(config.error)}
        </p>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 max-w-xs text-xs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Einstellung suchen"
              aria-label="Einstellung suchen"
            />
            <span className="ml-auto text-xs text-muted-foreground">
              {changed > 0 ? `${changed} Änderungen` : "Keine Änderungen"}
            </span>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={busy || changed === 0}
              onClick={() => setDraft({})}
            >
              Verwerfen
            </Button>
            <Button size="sm" type="submit" disabled={busy || changed === 0}>
              <Save className="size-3.5" /> {busy ? "Speichert…" : "Speichern"}
            </Button>
          </div>
          {GROUPS.map((group) => {
            const groupKeys = keys.filter((key) => groupOf(key) === group.label);
            if (groupKeys.length === 0) return null;
            return (
              <fieldset key={group.label} className="grid gap-2 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium">{group.label}</legend>
                {groupKeys.map((key) => {
                  const original = config.data[key] ?? null;
                  const value = key in draft ? draft[key] : original;
                  const id = `supabase-auth-config-${key}`;
                  return (
                    <div
                      key={key}
                      className="grid items-center gap-1 sm:grid-cols-[minmax(0,16rem)_1fr]"
                    >
                      <Label htmlFor={id} className="font-mono text-[11px] break-all">
                        {key}
                      </Label>
                      {typeof original === "boolean" ? (
                        <Switch
                          id={id}
                          checked={value === true}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            setDraft(({ [key]: _, ...rest }) =>
                              checked === original ? rest : { ...rest, [key]: checked },
                            )
                          }
                        />
                      ) : (
                        <Input
                          id={id}
                          className="h-8 text-xs"
                          type={SECRET.test(key) ? "password" : "text"}
                          inputMode={
                            typeof original === "number" || NUMERIC.test(key)
                              ? "numeric"
                              : undefined
                          }
                          value={value == null ? "" : String(value)}
                          placeholder={original === null ? "Nicht gesetzt" : undefined}
                          disabled={busy}
                          onChange={(event) => {
                            const text = event.target.value;
                            setDraft(({ [key]: _, ...rest }) =>
                              text === (original == null ? "" : String(original))
                                ? rest
                                : { ...rest, [key]: text },
                            );
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </form>
      )}
    </div>
  );
}
