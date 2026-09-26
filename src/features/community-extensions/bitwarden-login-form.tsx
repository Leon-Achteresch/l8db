import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SPRING_PANEL } from "@/lib/ease";
import type { Json } from "@/lib/extensions/contracts";
import type { VaultStatus } from "./password-manager";
import { VaultField } from "./vault-field";

const SERVERS = {
  com: "https://vault.bitwarden.com",
  eu: "https://vault.bitwarden.eu",
} as const;

type Server = "com" | "eu" | "custom";

function initialServer(url?: string): Server {
  if (!url || url === SERVERS.com) return "com";
  return url === SERVERS.eu ? "eu" : "custom";
}

export function BitwardenLoginForm({
  status,
  busy,
  onLogin,
  onLogout,
}: {
  status: VaultStatus;
  busy: boolean;
  onLogin: (input: Record<string, Json>) => void;
  onLogout: () => void;
}) {
  const [server, setServer] = useState<Server>(initialServer(status.server));
  const [url, setUrl] = useState(
    initialServer(status.server) === "custom" ? (status.server ?? "") : "",
  );
  const [email, setEmail] = useState(status.account ?? "");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [method, setMethod] = useState<"0" | "1">("0");
  const [code, setCode] = useState("");
  const locked = status.state === "locked";
  const needsCode = status.needs === "code" && !apiKey;
  const serverUrl = server === "custom" ? url.trim() : SERVERS[server];
  const credentials: Record<string, Json> = apiKey
    ? { server: serverUrl, clientId: clientId.trim(), clientSecret: clientSecret.trim(), password }
    : { server: serverUrl, email: email.trim(), password };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked) onLogin({ password });
    else onLogin(needsCode ? { ...credentials, method, code: code.trim() } : credentials);
  };

  if (locked)
    return (
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Angemeldet als <span className="font-medium text-foreground">{status.account}</span>. Der
          Tresor ist gesperrt.
        </p>
        <VaultField
          label="Master-Passwort"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !password}>
            {busy && <Spinner />}
            Entsperren
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onLogout}>
            Anderes Konto
          </Button>
        </div>
      </form>
    );

  return (
    <form onSubmit={submit} className="space-y-3">
      <SegmentedControl
        label="Bitwarden-Server"
        value={server}
        onChange={setServer}
        options={[
          { value: "com", label: "bitwarden.com" },
          { value: "eu", label: "bitwarden.eu" },
          { value: "custom", label: "Eigener Server" },
        ]}
      />
      {server === "custom" && (
        <VaultField
          label="Server-URL"
          type="url"
          placeholder="https://vault.example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      )}
      {apiKey ? (
        <div className="grid gap-3 @min-[40rem]:grid-cols-2">
          <VaultField
            label="client_id"
            autoComplete="off"
            spellCheck={false}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          />
          <VaultField
            label="client_secret"
            type="password"
            autoComplete="off"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </div>
      ) : (
        <VaultField
          label="E-Mail"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      )}
      <VaultField
        label="Master-Passwort"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <AnimatePresence initial={false}>
        {needsCode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_PANEL}
            className="-mx-1 overflow-hidden px-1"
          >
            <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
              <p className="text-xs">
                Bitwarden verlangt einen zweiten Faktor. Wähle die Methode und gib den Code ein.
              </p>
              <SegmentedControl
                label="Zweiter Faktor"
                value={method}
                onChange={setMethod}
                options={[
                  { value: "0", label: "Authenticator-App" },
                  { value: "1", label: "E-Mail" },
                ]}
              />
              <VaultField
                label="Bestätigungscode"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              {method === "1" && (
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  disabled={busy}
                  onClick={() => onLogin({ ...credentials, method: "1" })}
                >
                  Code per E-Mail senden
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            busy ||
            !password ||
            !serverUrl ||
            (apiKey ? !clientId || !clientSecret : !email) ||
            (needsCode && !code)
          }
        >
          {busy && <Spinner />}
          Anmelden
        </Button>
        <Button
          type="button"
          size="sm"
          variant="link"
          className="h-auto p-0 text-xs text-muted-foreground"
          onClick={() => setApiKey((value) => !value)}
        >
          {apiKey ? "Mit E-Mail anmelden" : "Stattdessen API-Schlüssel verwenden"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Das Master-Passwort geht nur an die Bitwarden-CLI und wird nicht gespeichert.
        {apiKey &&
          " Den API-Schlüssel findest du im Web-Tresor unter Kontoeinstellungen → Sicherheit → Schlüssel."}
      </p>
    </form>
  );
}
