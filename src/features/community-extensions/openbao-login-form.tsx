import { openUrl } from "@tauri-apps/plugin-opener";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Json } from "@/lib/extensions/contracts";
import type { VaultStatus } from "./password-manager";
import { VaultField } from "./vault-field";

type Method = "oidc" | "token";

export function OpenBaoLoginForm({
  status,
  busy,
  onLogin,
  onAnswer,
  onCancel,
}: {
  status: VaultStatus;
  busy: boolean;
  onLogin: (input: Record<string, Json>) => void;
  onAnswer: (input: Record<string, Json>) => void;
  onCancel: () => void;
}) {
  const saved = status.settings ?? {};
  const [server, setServer] = useState(status.server ?? "");
  const [path, setPath] = useState(saved.path ?? "secret/l8db");
  const [method, setMethod] = useState<Method>(saved.method === "token" ? "token" : "oidc");
  const [mount, setMount] = useState(saved.mount ?? "oidc");
  const [role, setRole] = useState(saved.role ?? "");
  const [token, setToken] = useState("");
  const waiting = status.needs === "browser";
  const answer = useRef(onAnswer);
  answer.current = onAnswer;
  const answered = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!waiting || answered.current === status.url) return;
    answered.current = status.url;
    answer.current({});
  }, [waiting, status.url]);

  const login = () => {
    answered.current = undefined;
    onLogin({
      server: server.trim(),
      path: path.trim(),
      method,
      ...(method === "token"
        ? { token: token.trim() }
        : { mount: mount.trim(), role: role.trim() }),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login();
  };

  const pending = busy || answered.current !== status.url;

  if (waiting)
    return (
      <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
        <p className="flex items-center gap-2 text-xs text-pretty">
          {pending && <Spinner className="size-3.5 shrink-0" />}
          {pending
            ? "Melde dich im Browser bei deiner Firma an. l8db wartet, bis die Anmeldung bestätigt ist."
            : "Die Anmeldung im Browser wurde nicht abgeschlossen."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {pending ? (
            status.url && (
              <Button size="sm" variant="outline" onClick={() => void openUrl(status.url ?? "")}>
                Anmeldeseite erneut öffnen
              </Button>
            )
          ) : (
            <Button size="sm" onClick={login}>
              Erneut versuchen
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-3">
      {status.state === "locked" && (
        <p className="text-xs text-pretty text-muted-foreground">
          {status.detail ?? "Deine Anmeldung ist abgelaufen. Melde dich erneut an."}
        </p>
      )}
      <VaultField
        label="Server-URL"
        type="url"
        placeholder="https://bao.firma.de"
        spellCheck={false}
        value={server}
        onChange={(event) => setServer(event.target.value)}
      />
      <SegmentedControl
        label="Anmeldung"
        value={method}
        onChange={setMethod}
        options={[
          { value: "oidc", label: "Im Browser (SSO)" },
          { value: "token", label: "Token" },
        ]}
      />
      {method === "oidc" ? (
        <div className="grid gap-3 @min-[40rem]:grid-cols-2">
          <VaultField
            label="Auth-Pfad"
            placeholder="oidc"
            spellCheck={false}
            value={mount}
            onChange={(event) => setMount(event.target.value)}
          />
          <VaultField
            label="Rolle (optional)"
            placeholder="Standardrolle"
            spellCheck={false}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </div>
      ) : (
        <VaultField
          label="Token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      )}
      <VaultField
        label="KV-Pfad der Zugänge"
        placeholder="secret/l8db"
        spellCheck={false}
        value={path}
        onChange={(event) => setPath(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        disabled={busy || !server.trim() || (method === "token" && !token.trim())}
      >
        {busy && <Spinner />}
        {method === "oidc" ? "Im Browser anmelden" : "Anmelden"}
      </Button>
      <p className="text-xs text-pretty text-muted-foreground">
        {method === "oidc"
          ? "l8db öffnet die Anmeldeseite deiner Firma, etwa Keycloak, im Browser. Auth-Pfad, Rolle und KV-Pfad nennt dir die IT."
          : "Das Token findest du in der OpenBao-Weboberfläche im Benutzermenü unter „Copy token“. Die OpenBao-CLI speichert es wie gewohnt in ~/.vault-token."}
      </p>
    </form>
  );
}
