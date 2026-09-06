import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  LockKeyhole,
  PlugZap,
  Save,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  connectionError,
  detectProvider,
  filePath,
  parseConnectionUrl,
  sslModeFromUrl,
} from "@/lib/connection-url";
import { type SavedConnection, type SshAuth, useConnectionsStore } from "@/lib/connections";
import { type ProviderInfo, type SslMode, testConnectionString } from "@/lib/db";
import { refreshDriverStatus, useProvidersStore } from "@/lib/providers";
import {
  deleteSecret,
  extractUrlPassword,
  loadSecret,
  storeSecret,
  withSslModeParam,
} from "@/lib/secrets";
import { useSettingsStore } from "@/lib/settings";
import {
  activateConnection,
  closeSshTunnel,
  openSshTunnel,
  sshSecretAccount,
  tunneledConnectionString,
} from "@/lib/ssh";
import { ConnectionField } from "./connection-field";

interface Props {
  connection?: SavedConnection;
  onSaved: () => void;
  onCancel: () => void;
}
type Mode = "string" | "fields";
type TestResult = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  ms?: number;
};

function placeholderDefaults(info: ProviderInfo) {
  try {
    const url = new URL(info.placeholder);
    return {
      host: url.hostname || "localhost",
      port: url.port || String(info.default_port ?? ""),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
    };
  } catch {
    return { host: "localhost", port: String(info.default_port ?? ""), database: "", user: "" };
  }
}

export function ConnectionEditor({ connection, onSaved, onCancel }: Props) {
  const queryClient = useQueryClient();
  const providers = useProvidersStore((state) => state.providers);
  const groups = [...new Set(providers.map((entry) => entry.group))];
  const [name, setName] = useState(connection?.name ?? "");
  const [value, setValue] = useState(connection?.connectionString ?? "");
  const [mode, setMode] = useState<Mode>("string");
  const [provider, setProvider] = useState(
    connection ? detectProvider(connection.connectionString, connection.kind) : "postgres",
  );
  const info = providers.find((entry) => entry.id === provider) ?? providers[0];
  const kind = info.kind;
  const caps = info.capabilities;
  const defaults = placeholderDefaults(info);
  const [ssl, setSsl] = useState<SslMode>(connection?.sslMode ?? sslModeFromUrl(value));
  const [showPassword, setShowPassword] = useState(false);
  const [host, setHost] = useState(defaults.host);
  const [port, setPort] = useState(defaults.port);
  const [database, setDatabase] = useState(defaults.database);
  const [user, setUser] = useState(defaults.user);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState("");
  const [extraParams, setExtraParams] = useState("");
  const [sshEnabled, setSshEnabled] = useState(Boolean(connection?.ssh?.host));
  const [sshHost, setSshHost] = useState(connection?.ssh?.host ?? "");
  const [sshPort, setSshPort] = useState(String(connection?.ssh?.port ?? 22));
  const [sshUser, setSshUser] = useState(connection?.ssh?.user ?? "");
  const [sshAuth, setSshAuth] = useState<SshAuth>(connection?.ssh?.auth ?? "key");
  const [sshKey, setSshKey] = useState(connection?.ssh?.keyFile ?? "");
  const [sshPassword, setSshPassword] = useState("");
  const [result, setResult] = useState<TestResult>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState(connection?.tags?.map((tag) => tag.name).join(", ") ?? "");
  const busy = saving || result.status === "testing";
  const operation = useRef(false);
  const withSsl = (url: string) => (caps.ssl ? withSslModeParam(url, ssl) : url);

  function selectProvider(id: string) {
    const next = providers.find((entry) => entry.id === id);
    if (!next) return;
    setProvider(id);
    setResult({ status: "idle" });
    const nextDefaults = placeholderDefaults(next);
    setHost(nextDefaults.host);
    setPort(nextDefaults.port);
    setDatabase(nextDefaults.database);
    setUser(nextDefaults.user);
    if (!value) setSsl(next.hosts.includes("localhost") ? "prefer" : "require");
  }

  function makeUrl() {
    if (info.file_based)
      return parseConnectionUrl(mode === "string" ? value : file, kind).toString();
    if (mode === "string") return withSsl(parseConnectionUrl(value, kind).toString());
    if (!host.trim()) throw new Error("Der Host ist erforderlich.");
    if (port) validatePort(port);
    const hostname = host.includes(":") && !host.startsWith("[") ? `[${host.trim()}]` : host.trim();
    const auth =
      user.trim() || password
        ? `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ""}@`
        : "";
    const url = new URL(
      `${info.url_schemes[0]}://${auth}${hostname}${port ? `:${port}` : ""}/${encodeURIComponent(database.trim())}`,
    );
    url.search = extraParams;
    return withSsl(parseConnectionUrl(url.toString(), kind).toString());
  }

  function validatePort(candidate: string) {
    if (!/^\d+$/.test(candidate) || Number(candidate) < 1 || Number(candidate) > 65535)
      throw new Error("Ports müssen zwischen 1 und 65535 liegen.");
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    try {
      if (next === "fields" && value.trim()) {
        if (info.file_based) setFile(filePath(value));
        else {
          const url = parseConnectionUrl(value, kind);
          setHost(url.hostname);
          setPort(url.port || String(info.default_port ?? ""));
          setDatabase(decodeURIComponent(url.pathname.slice(1)));
          setUser(decodeURIComponent(url.username));
          setPassword(decodeURIComponent(url.password));
          setExtraParams(url.search);
        }
      } else if (next === "string") setValue(info.file_based ? filePath(makeUrl()) : makeUrl());
      setMode(next);
      setResult({ status: "idle" });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    }
  }

  async function pickFile() {
    try {
      const picked = await open({ multiple: false, directory: false });
      if (typeof picked !== "string") return;
      if (mode === "string") setValue(picked);
      else setFile(picked);
      setResult({ status: "idle" });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    }
  }

  async function configuration() {
    const connectionString = makeUrl();
    const target = info.file_based ? null : parseConnectionUrl(connectionString, kind);
    const useSsh = caps.ssh && sshEnabled;
    if (useSsh) {
      validatePort(sshPort);
      if (!sshHost.trim() || !sshUser.trim())
        throw new Error("SSH-Host und SSH-Benutzer sind erforderlich.");
      if (sshAuth === "key" && !sshKey.trim()) throw new Error("Wähle eine SSH-Key-Datei.");
    }
    const secret =
      sshPassword ||
      (connection && useSsh ? await loadSecret(sshSecretAccount(connection.id)) : null) ||
      "";
    if (useSsh && sshAuth === "password" && !secret) throw new Error("Das SSH-Passwort fehlt.");
    return {
      connectionString,
      secret,
      ssh:
        useSsh && target
          ? {
              host: sshHost.trim(),
              port: Number(sshPort),
              user: sshUser.trim(),
              auth: sshAuth,
              keyFile: sshKey.trim(),
              remoteHost: target.hostname.replace(/^\[|\]$/g, ""),
              remotePort: Number(target.port || info.default_port || 0),
            }
          : null,
    };
  }

  async function test() {
    if (operation.current) return;
    operation.current = true;
    setResult({ status: "testing" });
    const started = performance.now();
    const tunnelId = `test-${crypto.randomUUID()}`;
    let tunnelOpened = false;
    try {
      const config = await configuration();
      let url = config.connectionString;
      if (config.ssh) {
        const tunnel = await openSshTunnel({
          id: tunnelId,
          host: config.ssh.host,
          port: config.ssh.port,
          user: config.ssh.user,
          auth:
            sshAuth === "key"
              ? { key_file: sshKey, ...(config.secret ? { passphrase: config.secret } : {}) }
              : { password: config.secret },
          remote_host: config.ssh.remoteHost,
          remote_port: config.ssh.remotePort,
          accept_new_host_key: useSettingsStore.getState().sshTrustNewHosts,
        });
        tunnelOpened = true;
        url = tunneledConnectionString(url, tunnel.local_port, kind);
      }
      await testConnectionString(kind, url);
      setResult({ status: "success", ms: Math.round(performance.now() - started) });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    } finally {
      if (tunnelOpened) await closeSshTunnel(tunnelId).catch(() => undefined);
      operation.current = false;
    }
  }

  async function save() {
    if (operation.current) return;
    operation.current = true;
    setSaving(true);
    try {
      if (!name.trim()) throw new Error("Gib der Verbindung einen Namen.");
      const config = await configuration();
      const id = connection?.id ?? crypto.randomUUID();
      const dbPassword = extractUrlPassword(config.connectionString);
      if (connection && useConnectionsStore.getState().activeId === id) {
        const outcome = await activateConnection(null);
        if (!outcome.ok) throw new Error(outcome.error);
      }
      if (dbPassword) {
        await storeSecret(id, dbPassword).catch(() =>
          toast.warning(
            "Datenbankpasswort gilt nur in dieser Sitzung: Schlüsselbund nicht verfügbar.",
          ),
        );
      } else if (connection) {
        await deleteSecret(id);
      }
      if (config.ssh && config.secret) {
        await storeSecret(sshSecretAccount(id), config.secret).catch(() =>
          toast.warning(
            "SSH-Zugangsdaten gelten nur in dieser Sitzung: Schlüsselbund nicht verfügbar.",
          ),
        );
      } else if (connection) {
        await deleteSecret(sshSecretAccount(id));
      }
      if (connection?.ssh) await closeSshTunnel(id).catch(() => undefined);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === id });
      const input = {
        name: name.trim(),
        kind,
        connectionString: config.connectionString,
        sslMode: ssl,
        ssh: config.ssh,
        tunnelPort: null,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ].map((name) => ({
          name,
          color: connection?.tags?.find((tag) => tag.name === name)?.color ?? "#4d8c78",
        })),
      };
      if (connection) useConnectionsStore.getState().updateConnection(id, input);
      else
        useConnectionsStore.setState((state) => ({
          connections: [...state.connections, { ...input, id }],
        }));
      toast.success("Verbindung gespeichert");
      onSaved();
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    } finally {
      setSaving(false);
      operation.current = false;
    }
  }

  const databaseLabel =
    kind === "oracle"
      ? "Service-Name"
      : kind === "cassandra"
        ? "Keyspace"
        : kind === "redis"
          ? "Datenbank-Nummer"
          : "Datenbank";

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-6 py-5">
        <div>
          <p className="eyebrow">Verbindung einrichten</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            {connection ? connection.name : "Ein neuer Datenbankzugang"}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Editor schließen"
          disabled={busy}
          onClick={onCancel}
        >
          <X className="size-4" />
        </Button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onChange={() => setResult({ status: "idle" })}
      >
        <fieldset disabled={busy} className="space-y-5 p-6 disabled:opacity-70">
          <div className="grid gap-2">
            <Label htmlFor="connection-provider" className="text-xs text-muted-foreground">
              Datenbank
            </Label>
            <NativeSelect
              id="connection-provider"
              value={provider}
              onChange={(event) => selectProvider(event.target.value)}
              className="w-full"
            >
              {groups.map((group) => (
                <NativeSelectOptGroup key={group} label={group}>
                  {providers
                    .filter((entry) => entry.group === group)
                    .map((entry) => (
                      <NativeSelectOption key={entry.id} value={entry.id}>
                        {entry.name}
                        {entry.driver_status.available ? "" : " · Treiber fehlt"}
                      </NativeSelectOption>
                    ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
            <p className="text-xs leading-relaxed text-muted-foreground">{info.hint}</p>
          </div>
          {!info.driver_status.available && (
            <div
              role="status"
              className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
            >
              <p>{info.driver_status.detail}</p>
              {info.driver_status.install.map((hint) => (
                <div
                  key={`${hint.os}${hint.command}${hint.url}`}
                  className="flex items-center gap-2"
                >
                  <span className="w-16 shrink-0 font-medium">{hint.os}</span>
                  {hint.command ? (
                    <>
                      <code className="min-w-0 flex-1 truncate rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">
                        {hint.command}
                      </code>
                      <button
                        type="button"
                        aria-label="Befehl kopieren"
                        onClick={() => void navigator.clipboard.writeText(hint.command)}
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <a
                      href={hint.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate underline"
                    >
                      {hint.url}
                    </a>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="underline"
                onClick={() => void refreshDriverStatus(kind).catch(() => undefined)}
              >
                Erneut prüfen
              </button>
            </div>
          )}
          <ConnectionField
            id="connection-name"
            label="Verbindungsname"
            placeholder="z. B. Produktion, Staging, Lokal"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <SegmentedControl
            value={mode}
            onChange={switchMode}
            label="Verbindungseingabe"
            options={[
              { value: "string", label: info.file_based ? "Dateipfad" : "Connection-URL" },
              { value: "fields", label: "Einzelne Felder" },
            ]}
          />
          {mode === "string" ? (
            <div className="relative">
              <ConnectionField
                id="connection-url"
                label={info.file_based ? "Datenbankdatei" : "Verbindungs-URL"}
                type={info.file_based || showPassword ? "text" : "password"}
                placeholder={info.placeholder}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (caps.ssl) setSsl(sslModeFromUrl(event.target.value));
                  if (event.target.value.trim())
                    setProvider(detectProvider(event.target.value, kind));
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                aria-label={
                  info.file_based
                    ? "Datei auswählen"
                    : showPassword
                      ? "URL verbergen"
                      : "URL anzeigen"
                }
                onClick={() => (info.file_based ? void pickFile() : setShowPassword(!showPassword))}
                className="absolute right-2 bottom-2 rounded bg-card p-1 text-muted-foreground"
              >
                {info.file_based ? (
                  <FolderOpen className="size-4" />
                ) : showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          ) : info.file_based ? (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <ConnectionField
                  id="connection-file"
                  label="Datenbankdatei"
                  placeholder={info.placeholder}
                  value={file}
                  onChange={(event) => setFile(event.target.value)}
                  spellCheck={false}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => void pickFile()}
              >
                <FolderOpen className="size-4" />
                Durchsuchen
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <ConnectionField
                  id="connection-host"
                  label="Host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
                <ConnectionField
                  id="connection-port"
                  label="Port"
                  inputMode="numeric"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </div>
              <ConnectionField
                id="connection-database"
                label={databaseLabel}
                value={database}
                placeholder={defaults.database}
                onChange={(event) => setDatabase(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <ConnectionField
                  id="connection-user"
                  label="Benutzer"
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                />
                <ConnectionField
                  id="connection-password"
                  label="Passwort"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
          )}
          {provider === "supabase" && /:6543(?:\/|$)/.test(value) && (
            <p
              role="status"
              className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
            >
              Du nutzt einen Transaction Pooler. Für den vollständigen SQL-Arbeitsplatz nutze eine
              direkte Verbindung oder den Session Pooler auf Port 5432.
            </p>
          )}
          {caps.ssl && (
            <div className="grid gap-2">
              <Label htmlFor="connection-ssl" className="text-xs text-muted-foreground">
                SSL / TLS
              </Label>
              <NativeSelect
                id="connection-ssl"
                value={ssl}
                onChange={(event) => setSsl(event.target.value as SslMode)}
                className="w-full"
              >
                <NativeSelectOption value="prefer">
                  Bevorzugen · für lokale Server
                </NativeSelectOption>
                <NativeSelectOption value="require">
                  Erforderlich · System-Zertifikate prüfen
                </NativeSelectOption>
                <NativeSelectOption value="verify-full">
                  Zertifikat und Hostname prüfen
                </NativeSelectOption>
                <NativeSelectOption value="verify-ca">
                  Zertifizierungsstelle prüfen
                </NativeSelectOption>
                <NativeSelectOption value="disable">Deaktiviert</NativeSelectOption>
              </NativeSelect>
            </div>
          )}
          {caps.ssh && (
            <div className="rounded-xl border p-4">
              <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-medium">
                <span className="flex items-center gap-2">
                  <LockKeyhole className="size-4 text-muted-foreground" /> SSH-Tunnel
                </span>
                <input
                  type="checkbox"
                  checked={sshEnabled}
                  onChange={(event) => setSshEnabled(event.target.checked)}
                  className="size-4 accent-primary"
                />
              </label>
              {sshEnabled && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Der Datenbank-Host oben wird vom SSH-Server aus erreicht.
                  </p>
                  <div className="grid grid-cols-[1fr_80px] gap-3">
                    <ConnectionField
                      id="ssh-host"
                      label="SSH-Host"
                      value={sshHost}
                      onChange={(event) => setSshHost(event.target.value)}
                    />
                    <ConnectionField
                      id="ssh-port"
                      label="SSH-Port"
                      value={sshPort}
                      onChange={(event) => setSshPort(event.target.value)}
                    />
                  </div>
                  <ConnectionField
                    id="ssh-user"
                    label="SSH-Benutzer"
                    value={sshUser}
                    onChange={(event) => setSshUser(event.target.value)}
                  />
                  <div className="grid gap-2">
                    <Label htmlFor="ssh-auth">Authentifizierung</Label>
                    <NativeSelect
                      id="ssh-auth"
                      value={sshAuth}
                      onChange={(event) => setSshAuth(event.target.value as SshAuth)}
                    >
                      <NativeSelectOption value="key">SSH-Key</NativeSelectOption>
                      <NativeSelectOption value="password">Passwort</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  {sshAuth === "key" && (
                    <ConnectionField
                      id="ssh-key"
                      label="Absoluter Pfad zur Key-Datei"
                      placeholder="/Users/name/.ssh/id_ed25519"
                      value={sshKey}
                      onChange={(event) => setSshKey(event.target.value)}
                    />
                  )}
                  <ConnectionField
                    id="ssh-password"
                    label={sshAuth === "key" ? "Passphrase (optional)" : "SSH-Passwort"}
                    type="password"
                    value={sshPassword}
                    placeholder={
                      connection ? "Leer lassen, um gespeicherten Wert zu verwenden" : ""
                    }
                    onChange={(event) => setSshPassword(event.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          <ConnectionField
            id="connection-tags"
            label="Tags · durch Komma getrennt"
            placeholder="Produktion, Team, Projekt"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </fieldset>
        <footer className="space-y-4 border-t bg-muted/25 p-5">
          <div aria-live="polite">
            {result.status === "testing" && (
              <AnimatedBadge status="loading" size="sm">
                Verbindung wird geprüft
              </AnimatedBadge>
            )}
            {result.status === "success" && (
              <AnimatedBadge status="success" size="sm">
                Erreichbar · {result.ms} ms
              </AnimatedBadge>
            )}
            {result.status === "error" && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
              >
                {result.message}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => void test()}
            >
              <PlugZap className="size-4" />
              Testen
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              <Save className="size-4" />
              {saving ? "Speichern…" : "Speichern"}
              <ArrowUpRight className="size-3" />
            </Button>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <LockKeyhole className="size-3" />
            Passwörter im System-Schlüsselbund · kein l8db-Konto
          </p>
        </footer>
      </form>
    </section>
  );
}
