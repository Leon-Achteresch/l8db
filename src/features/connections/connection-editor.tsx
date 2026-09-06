import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  Eye,
  EyeOff,
  FolderOpen,
  LockKeyhole,
  PlugZap,
  Save,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { SlideActionButton } from "@/components/motion/slide-action-button";
import { DriverDetail } from "@/components/driver-detail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ProviderLogo } from "@/components/provider-logo";
import { useDbThemeStore } from "@/lib/db-theme";
import { ProviderTile } from "./provider-tile";
import { SetupStepper } from "./setup-stepper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [step, setStep] = useState<1 | 2 | 3>(connection ? 2 : 1);
  const reduce = useReducedMotion();
  const setPreview = useDbThemeStore((state) => state.setPreview);
  const [tags, setTags] = useState(connection?.tags?.map((tag) => tag.name).join(", ") ?? "");
  const busy = saving || result.status === "testing";
  const operation = useRef(false);
  const withSsl = (url: string) => (caps.ssl ? withSslModeParam(url, ssl) : url);

  useEffect(() => {
    setPreview(kind, provider);
    return () => setPreview(null);
  }, [kind, provider, setPreview]);

  function selectProvider(id: string) {
    const next = providers.find((entry) => entry.id === id);
    if (!next) return;
    setProvider(id);
    setPreview(next.kind, next.id);
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
    <section className="shell-bezel flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {connection ? connection.name : "Neue Verbindung"}
          </h2>
          <p className="truncate text-xs text-muted-foreground">{info.name}</p>
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
      <div className="shrink-0 px-4 pb-3">
        <SetupStepper step={step} onStep={(next) => setStep(next)} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 3) void save();
        }}
        onChange={() => setResult({ status: "idle" })}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <fieldset disabled={busy} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 disabled:opacity-70">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduce ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="pb-2"
            >
              {step === 1 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    Wähle die Engine. Die Oberfläche wechselt mit.
                  </p>
                  <div className="pr-1">
                    {groups.map((group) => (
                      <div key={group} className="mb-3">
                        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{group}</p>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                          {providers
                            .filter((entry) => entry.group === group)
                            .map((entry) => (
                              <ProviderTile
                                key={entry.id}
                                provider={entry}
                                selected={provider === entry.id}
                                onSelect={() => selectProvider(entry.id)}
                              />
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">{info.hint}</p>
                </div>
              )}
              {step === 2 && (
                <div className="flex flex-col gap-2 pr-1">
                  {!info.driver_status.available && (
                    <div
                      role="status"
                      className="space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300"
                    >
                      <DriverDetail detail={info.driver_status.detail} className="block" />
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void refreshDriverStatus(kind).catch(() => undefined)}
                        >
                          Erneut prüfen
                        </button>
                        <Link to="/drivers" className="underline">
                          Treiber
                        </Link>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-xl bg-background ring-1 ring-border">
                      <ProviderLogo providerId={provider} kind={kind} className="size-4" />
                    </span>
                    <ConnectionField
                      id="connection-name"
                      label="Name"
                      placeholder="Produktion, Staging, Lokal"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <SegmentedControl
                    value={mode}
                    onChange={switchMode}
                    label="Verbindungseingabe"
                    options={[
                      { value: "string", label: info.file_based ? "Pfad" : "URL" },
                      { value: "fields", label: "Felder" },
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
              className="min-w-0 break-words rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300"
            >
              Du nutzt einen Transaction Pooler. Für den vollständigen SQL-Arbeitsplatz nutze eine
              direkte Verbindung oder den Session Pooler auf Port 5432.
            </p>
          )}
          {(caps.ssl || caps.ssh) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {caps.ssl && (
                <div className="grid gap-1">
                  <Label htmlFor="connection-ssl" className="text-xs text-muted-foreground">
                    SSL / TLS
                  </Label>
                  <Select value={ssl} onValueChange={(value) => setSsl(value as SslMode)}>
                    <SelectTrigger id="connection-ssl" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="prefer">Bevorzugen · für lokale Server</SelectItem>
                      <SelectItem value="require">
                        Erforderlich · System-Zertifikate prüfen
                      </SelectItem>
                      <SelectItem value="verify-full">Zertifikat und Hostname prüfen</SelectItem>
                      <SelectItem value="verify-ca">Zertifizierungsstelle prüfen</SelectItem>
                      <SelectItem value="disable">Deaktiviert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {caps.ssh && (
                <label className="flex h-9 items-end justify-between gap-3 pb-0.5 text-xs font-medium sm:h-auto sm:items-center sm:self-end sm:pb-2">
                  <span className="flex items-center gap-2">
                    <LockKeyhole className="size-4 text-muted-foreground" /> SSH-Tunnel
                  </span>
                  <Switch
                    checked={sshEnabled}
                    onCheckedChange={setSshEnabled}
                    aria-label="SSH-Tunnel"
                  />
                </label>
              )}
            </div>
          )}
          {caps.ssh && sshEnabled && (
            <div className="space-y-3 rounded-xl border p-3">
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
                    <Select
                      value={sshAuth}
                      onValueChange={(value) => setSshAuth(value as SshAuth)}
                    >
                      <SelectTrigger id="ssh-auth" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="key">SSH-Key</SelectItem>
                        <SelectItem value="password">Passwort</SelectItem>
                      </SelectContent>
                    </Select>
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
                  <ConnectionField
                    id="connection-tags"
                    label="Tags"
                    placeholder="Produktion, Team"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                </div>
              )}
              {step === 3 && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border bg-card/80 p-4">
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 place-items-center rounded-2xl bg-background ring-1 ring-border">
                        <ProviderLogo providerId={provider} kind={kind} className="size-7" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{name || "Unbenannt"}</p>
                        <p className="truncate text-xs text-muted-foreground">{info.name}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {caps.ssl ? `TLS ${ssl}` : "Ohne TLS"}
                      {sshEnabled ? " · SSH-Tunnel" : ""}
                    </p>
                  </div>
                  <div aria-live="polite" className="min-h-8">
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
                        className="break-words rounded-xl bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
                      >
                        {result.message}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void test()}>
                      <PlugZap className="size-4" />
                      Testen
                    </Button>
                    <SlideActionButton
                      className="h-14 w-64"
                      completeLabel="Gespeichert"
                      onComplete={() => void save()}
                    >
                      Speichern
                    </SlideActionButton>
                  </div>
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <LockKeyhole className="size-3" />
                    Passwörter bleiben im System-Schlüsselbund
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </fieldset>
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/50 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || step === 1}
            onClick={() => setStep((current) => (current === 1 ? 1 : ((current - 1) as 1 | 2 | 3)))}
          >
            Zurück
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              disabled={busy || (step === 1 && !info.driver_status.available)}
              onClick={() => {
                requestAnimationFrame(() =>
                  setStep((current) => (current === 3 ? 3 : ((current + 1) as 1 | 2 | 3))),
                );
              }}
            >
              Weiter
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void save()}>
              <Save className="size-4" />
              {saving ? "Speichern…" : "Speichern"}
            </Button>
          )}
        </footer>
      </form>
    </section>
  );
}
