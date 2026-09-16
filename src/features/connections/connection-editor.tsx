import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff, FolderOpen as FolderOpenData } from "lucide";
import { ArrowRight, FolderOpen, LockKeyhole, PlugZap, RefreshCw, X } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DriverDetail } from "@/components/driver-detail";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { SlideActionButton } from "@/components/motion/slide-action-button";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { withTimeout } from "@/lib/async";
import { defaultSslModeForProvider, initialSslMode } from "@/lib/connection-defaults";
import { serverLabel } from "@/lib/connection-groups";
import {
  connectionError,
  connectionSummary,
  detectProvider,
  filePath,
  isTrustedConnection,
  kindFromUrl,
  oracleConnectString,
  parseConnectionUrl,
} from "@/lib/connection-url";
import { type SavedConnection, type SshAuth, useConnectionsStore } from "@/lib/connections";
import {
  type DatabaseKind,
  listSchemas,
  openTnsNames,
  oracleTnsNames,
  type ProviderInfo,
  type SslMode,
  testConnectionString,
} from "@/lib/db";
import { useDbThemeStore } from "@/lib/db-theme";
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
import { ConnectionAdvancedOptions } from "./connection-advanced-options";
import { ConnectionField } from "./connection-field";
import { ProviderTile } from "./provider-tile";
import { SetupStepper } from "./setup-stepper";

interface Props {
  connection?: SavedConnection;
  template?: SavedConnection;
  onSaved: () => void;
  onCancel: () => void;
}
type Mode = "string" | "fields" | "tns";
type TestResult = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  ms?: number;
};
const TEST_TIMEOUT_MS = 30_000;

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

function seedFields(seed: SavedConnection | undefined, info: ProviderInfo, clearUser: boolean) {
  const defaults = placeholderDefaults(info);
  if (!seed) {
    return {
      ...defaults,
      password: "",
      file: "",
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
  if (info.file_based) {
    return {
      ...defaults,
      password: "",
      file: filePath(seed.connectionString),
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
  try {
    const url = parseConnectionUrl(seed.connectionString, seed.kind);
    return {
      host: url.hostname || defaults.host,
      port: url.port || defaults.port,
      database: decodeURIComponent(url.pathname.slice(1)),
      user: clearUser ? "" : decodeURIComponent(url.username),
      password: clearUser ? "" : decodeURIComponent(url.password),
      file: "",
      extraParams: url.search,
      trusted: isTrustedConnection(url),
      tnsAlias: seed.kind === "oracle" ? (oracleConnectString(url) ?? "") : "",
    };
  } catch {
    const summary = connectionSummary(seed.connectionString, seed.kind);
    return {
      host: summary.host || defaults.host,
      port: summary.port || defaults.port,
      database: summary.database || defaults.database,
      user: clearUser ? "" : summary.user,
      password: clearUser ? "" : (extractUrlPassword(seed.connectionString) ?? ""),
      file: "",
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
}

function seedMode(seed: SavedConnection | undefined, info: ProviderInfo): Mode {
  if (!seed || info.file_based) return "fields";
  try {
    const url = parseConnectionUrl(seed.connectionString, seed.kind);
    if (seed.kind === "oracle" && oracleConnectString(url)) return "tns";
  } catch {
    return "fields";
  }
  return "fields";
}

export function ConnectionEditor({ connection, template, onSaved, onCancel }: Props) {
  const queryClient = useQueryClient();
  const providers = useProvidersStore((state) => state.providers);
  const groups = [...new Set(providers.map((entry) => entry.group))];
  const seed = connection ?? template;
  const [name, setName] = useState(connection?.name ?? "");
  const [value, setValue] = useState(connection?.connectionString ?? "");
  const [provider, setProvider] = useState(
    seed ? detectProvider(seed.connectionString, seed.kind) : "postgres",
  );
  const info = providers.find((entry) => entry.id === provider) ?? providers[0];
  const kind = info.kind;
  const caps = info.capabilities;
  const initial = seedFields(seed, info, Boolean(template) && !connection);
  const [mode, setMode] = useState<Mode>(() => seedMode(seed, info));
  const [ssl, setSsl] = useState<SslMode>(() =>
    initialSslMode(
      value,
      useSettingsStore.getState().sslDefaultMode,
      seed?.sslMode,
      kind,
      provider,
    ),
  );
  const [showPassword, setShowPassword] = useState(false);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [database, setDatabase] = useState(initial.database);
  const [user, setUser] = useState(initial.user);
  const [password, setPassword] = useState(initial.password);
  const [file, setFile] = useState(initial.file);
  const [extraParams, setExtraParams] = useState(initial.extraParams);
  const [trusted, setTrusted] = useState(initial.trusted);
  const [tnsAlias, setTnsAlias] = useState(initial.tnsAlias);
  const [tns, setTns] = useState<{ path: string | null; aliases: string[] } | null>(null);
  const [sshEnabled, setSshEnabled] = useState(Boolean(seed?.ssh?.host));
  const [sshHost, setSshHost] = useState(seed?.ssh?.host ?? "");
  const [sshPort, setSshPort] = useState(String(seed?.ssh?.port ?? 22));
  const [sshUser, setSshUser] = useState(seed?.ssh?.user ?? "");
  const [sshAuth, setSshAuth] = useState<SshAuth>(seed?.ssh?.auth ?? "key");
  const [sshKey, setSshKey] = useState(seed?.ssh?.keyFile ?? "");
  const [sshPassword, setSshPassword] = useState("");
  const [result, setResult] = useState<TestResult>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const guided = !seed;
  const [step, setStep] = useState<1 | 2>(guided ? 1 : 2);
  const reduce = useReducedMotion();
  const setPreview = useDbThemeStore((state) => state.setPreview);
  const [tags, setTags] = useState(seed?.tags?.map((tag) => tag.name).join(", ") ?? "");
  const [color, setColor] = useState<string | null>(seed?.color ?? null);
  const [readOnly, setReadOnly] = useState(Boolean(seed?.readOnly));
  const [schemaFilter, setSchemaFilter] = useState<string[]>(seed?.schemas ?? []);
  const [scannedSchemas, setScannedSchemas] = useState<string[] | null>(null);
  const [scannedUser, setScannedUser] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const busy = saving || result.status === "testing";
  const operation = useRef(false);
  const withSsl = (url: string) => (caps.ssl ? withSslModeParam(url, ssl) : url);
  const windowsAuth = kind === "mssql" && trusted;
  const quickKind = kindFromUrl(value) ?? kind;
  const quickProviderId = value.trim() ? detectProvider(value, quickKind) : provider;
  const quickInfo = providers.find((entry) => entry.id === quickProviderId) ?? info;
  const poolerWarning =
    (mode === "string" ? quickProviderId : provider) === "supabase" &&
    (port === "6543" || /:6543(?:\/|$)/.test(value));
  const advancedOpen = Boolean(
    seed?.ssh?.host || seed?.readOnly || seed?.schemas?.length || seed?.color || seed?.tags?.length,
  );

  useEffect(() => {
    if (mode === "string") setPreview(quickKind, quickProviderId);
    else setPreview(kind, provider);
    return () => setPreview(null);
  }, [mode, quickKind, quickProviderId, kind, provider, setPreview]);

  useEffect(() => {
    const id = connection?.id;
    if (!id) return;
    void loadSecret(id).then((secret) => {
      if (secret) setPassword((current) => current || secret);
    });
  }, [connection?.id]);

  useEffect(() => {
    if (result.status !== "testing") return;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [result.status]);

  useEffect(() => {
    if (mode === "tns" && !tns) void oracleTnsNames().then(setTns);
  }, [mode, tns]);

  function selectProvider(id: string) {
    const next = providers.find((entry) => entry.id === id);
    if (!next) return;
    setProvider(id);
    if (mode === "tns" && next.kind !== "oracle") setMode("fields");
    setPreview(next.kind, next.id);
    setResult({ status: "idle" });
    const nextDefaults = placeholderDefaults(next);
    setHost(nextDefaults.host);
    setPort(nextDefaults.port);
    setDatabase(nextDefaults.database);
    setUser(nextDefaults.user);
    if (!value)
      setSsl(
        defaultSslModeForProvider(next.kind, next.id, useSettingsStore.getState().sslDefaultMode),
      );
    if (step === 1 && next.driver_status.available) setStep(2);
  }

  function pasteConnectionString() {
    setMode("string");
    setResult({ status: "idle" });
    setStep(2);
  }

  function makeUrl() {
    if (mode === "string") {
      const inputKind = kindFromUrl(value) ?? kind;
      const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
      if (!value.trim()) {
        throw new Error(
          inputInfo.file_based
            ? "Gib den Pfad zur Datenbankdatei an."
            : "Gib eine Verbindungs-URL ein, z. B. postgresql://…",
        );
      }
      if (inputInfo.file_based) return parseConnectionUrl(value, inputKind).toString();
      const connectionString = parseConnectionUrl(value, inputKind).toString();
      return inputInfo.capabilities.ssl
        ? withSslModeParam(connectionString, ssl)
        : connectionString;
    }
    if (info.file_based) return parseConnectionUrl(file, kind).toString();
    if (mode === "tns") {
      const alias = tnsAlias.trim();
      if (!alias) throw new Error("Wähle einen TNS-Alias aus.");
      if (!user.trim()) throw new Error("Der Benutzer ist erforderlich.");
      const auth = `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ""}@`;
      return parseConnectionUrl(
        `oracle://${auth}${encodeURIComponent(alias)}/?connect_string=${encodeURIComponent(alias)}`,
        kind,
      ).toString();
    }
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
    if (windowsAuth) url.searchParams.set("trusted_connection", "true");
    return withSsl(parseConnectionUrl(url.toString(), kind).toString());
  }

  function validatePort(candidate: string) {
    if (!/^\d+$/.test(candidate) || Number(candidate) < 1 || Number(candidate) > 65535)
      throw new Error("Ports müssen zwischen 1 und 65535 liegen.");
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    try {
      if (next !== "string" && value.trim()) {
        const inputKind = kindFromUrl(value) ?? kind;
        const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
        setProvider(detectProvider(value, inputKind));
        if (inputInfo.file_based) setFile(filePath(value));
        else {
          const url = parseConnectionUrl(value, inputKind);
          const alias = inputKind === "oracle" ? oracleConnectString(url) : null;
          if (alias) setTnsAlias(alias);
          setHost(url.hostname);
          setPort(url.port || String(inputInfo.default_port ?? ""));
          setDatabase(decodeURIComponent(url.pathname.slice(1)));
          setUser(decodeURIComponent(url.username));
          setPassword(decodeURIComponent(url.password));
          setExtraParams(url.search);
          setTrusted(isTrustedConnection(url));
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
    const inputKind = mode === "string" ? (kindFromUrl(value) ?? kind) : kind;
    const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
    const connectionString = makeUrl();
    const target = inputInfo.file_based ? null : parseConnectionUrl(connectionString, inputKind);
    const useSsh = inputInfo.capabilities.ssh && sshEnabled;
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
      kind: inputKind,
      ssh:
        useSsh && target
          ? {
              host: sshHost.trim(),
              port: Number(sshPort),
              user: sshUser.trim(),
              auth: sshAuth,
              keyFile: sshKey.trim(),
              remoteHost: target.hostname.replace(/^\[|\]$/g, ""),
              remotePort: Number(target.port || inputInfo.default_port || 0),
            }
          : null,
    };
  }

  async function withLiveUrl<T>(run: (kind: DatabaseKind, url: string) => Promise<T>) {
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
        url = tunneledConnectionString(url, tunnel.local_port, config.kind);
      }
      return await withTimeout(
        run(config.kind, url),
        TEST_TIMEOUT_MS,
        `Zeitüberschreitung nach ${TEST_TIMEOUT_MS / 1000} s. Prüfe Host, Port und Firewall.`,
      );
    } finally {
      if (tunnelOpened) await closeSshTunnel(tunnelId).catch(() => undefined);
    }
  }

  async function test() {
    if (operation.current) return;
    operation.current = true;
    setResult({ status: "testing" });
    const started = performance.now();
    try {
      await withLiveUrl((liveKind, url) => testConnectionString(liveKind, url));
      setResult({ status: "success", ms: Math.round(performance.now() - started) });
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    } finally {
      operation.current = false;
    }
  }

  async function scanSchemas() {
    if (operation.current) return;
    operation.current = true;
    setScanning(true);
    setScanError(null);
    try {
      const list = await withLiveUrl((liveKind, url) => {
        setScannedUser(decodeURIComponent(new URL(url).username));
        return listSchemas(liveKind, url);
      });
      setScannedSchemas(list);
    } catch (error) {
      setScanError(connectionError(error));
    } finally {
      setScanning(false);
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
      const configInfo = providers.find((entry) => entry.kind === config.kind) ?? info;
      const id = connection?.id ?? crypto.randomUUID();
      const dbPassword =
        extractUrlPassword(config.connectionString) ?? (connection ? await loadSecret(id) : null);
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
        kind: config.kind,
        connectionString: config.connectionString,
        sslMode: ssl,
        ssh: config.ssh,
        tunnelPort: null,
        favorite: connection?.favorite ?? false,
        readOnly: readOnly && configInfo.capabilities.read_only_mode,
        schemas: configInfo.capabilities.schemas && schemaFilter.length ? schemaFilter : null,
        color,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ].map((tagName) => ({
          name: tagName,
          color: connection?.tags?.find((tag) => tag.name === tagName)?.color ?? "#4d8c78",
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
  const activeInfo = mode === "string" ? quickInfo : info;

  return (
    <section
      data-tour="connection-editor"
      className="shell-bezel flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {connection
              ? connection.name
              : template
                ? `Weitere Verbindung auf ${serverLabel(template)}`
                : "Neue Verbindung"}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {step === 1 ? "Welche Datenbank willst du öffnen?" : activeInfo.name}
          </p>
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
      {guided && (
        <div className="shrink-0 px-4 pb-3">
          <SetupStepper step={step} onStep={(next) => setStep(next)} />
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 2) void save();
        }}
        onChange={() => setResult({ status: "idle" })}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <fieldset
          disabled={busy}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 disabled:opacity-70"
        >
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
                    Tippe auf eine Kachel. Danach kommen nur noch Name und Zugangsdaten.
                  </p>
                  <div className="pr-1">
                    {groups.map((group) => (
                      <div key={group} className="mb-3">
                        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                          {group}
                        </p>
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start text-xs"
                    onClick={pasteConnectionString}
                  >
                    Ich habe schon einen Connection-String
                  </Button>
                </div>
              )}
              {step === 2 && (
                <div className="flex flex-col gap-3 pr-1">
                  {!activeInfo.driver_status.available && (
                    <div
                      role="status"
                      className="space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300"
                    >
                      <DriverDetail detail={activeInfo.driver_status.detail} className="block" />
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            void refreshDriverStatus(mode === "string" ? quickKind : kind).catch(
                              () => undefined,
                            )
                          }
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
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-border">
                      <ProviderLogo
                        providerId={mode === "string" ? quickProviderId : provider}
                        kind={mode === "string" ? quickKind : kind}
                        className="size-4"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <ConnectionField
                        id="connection-name"
                        label="Name"
                        placeholder="Lokal, Staging, Produktion"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {guided && (
                    <button
                      type="button"
                      className="self-start text-[11px] text-muted-foreground underline"
                      onClick={() => setStep(1)}
                    >
                      Andere Datenbank wählen
                    </button>
                  )}
                  {!info.file_based && (
                    <SegmentedControl
                      value={mode}
                      onChange={switchMode}
                      label="Verbindungseingabe"
                      options={[
                        { value: "fields", label: "Felder" },
                        { value: "string", label: "URL" },
                        ...(kind === "oracle" ? [{ value: "tns" as const, label: "TNS" }] : []),
                      ]}
                    />
                  )}
                  {mode === "string" ? (
                    <div className="relative">
                      <ConnectionField
                        id="connection-url"
                        label={quickInfo.file_based ? "Datenbankdatei" : "Connection-String"}
                        type={quickInfo.file_based || showPassword ? "text" : "password"}
                        placeholder={quickInfo.placeholder}
                        value={value}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setValue(nextValue);
                          if (nextValue.trim()) {
                            const nextKind = kindFromUrl(nextValue);
                            setSsl(
                              initialSslMode(
                                nextValue,
                                useSettingsStore.getState().sslDefaultMode,
                                undefined,
                                nextKind,
                                nextKind ? detectProvider(nextValue, nextKind) : undefined,
                              ),
                            );
                          }
                          const inputKind = kindFromUrl(nextValue);
                          if (inputKind) setProvider(detectProvider(nextValue, inputKind));
                        }}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        aria-label={
                          quickInfo.file_based
                            ? "Datei auswählen"
                            : showPassword
                              ? "URL verbergen"
                              : "URL anzeigen"
                        }
                        onClick={() =>
                          quickInfo.file_based ? void pickFile() : setShowPassword(!showPassword)
                        }
                        className="absolute right-2 bottom-2 rounded bg-card p-1 text-muted-foreground"
                      >
                        <MorphIcon
                          icon={quickInfo.file_based ? FolderOpenData : showPassword ? EyeOff : Eye}
                          className="size-4"
                        />
                      </button>
                    </div>
                  ) : mode === "tns" ? (
                    <div className="space-y-4">
                      <div className="grid gap-1">
                        <Label htmlFor="connection-tns" className="text-xs text-muted-foreground">
                          TNS-Alias
                        </Label>
                        <div className="flex items-end gap-2">
                          <Select value={tnsAlias} onValueChange={setTnsAlias}>
                            <SelectTrigger id="connection-tns" className="w-full">
                              <SelectValue
                                placeholder={
                                  tns?.aliases.length ? "Alias wählen" : "Keine Aliase gefunden"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent position="popper" searchable>
                              {(tns?.aliases.includes(tnsAlias) || !tnsAlias
                                ? (tns?.aliases ?? [])
                                : [tnsAlias, ...(tns?.aliases ?? [])]
                              ).map((alias) => (
                                <SelectItem key={alias} value={alias}>
                                  {alias}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            aria-label="tnsnames.ora neu laden"
                            onClick={() => void oracleTnsNames().then(setTns)}
                          >
                            <RefreshCw className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            onClick={() =>
                              openTnsNames().catch((error) => toast.error(connectionError(error)))
                            }
                          >
                            TNSNames Editor
                          </Button>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {tns?.path ??
                            "Keine tnsnames.ora gefunden: TNS_ADMIN setzen oder unter <Instant Client>/network/admin ablegen."}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <ConnectionField
                          id="connection-tns-user"
                          label="Benutzer"
                          value={user}
                          onChange={(event) => setUser(event.target.value)}
                        />
                        <ConnectionField
                          id="connection-tns-password"
                          label="Passwort"
                          type="password"
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </div>
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
                    <div className="space-y-3">
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
                        placeholder={placeholderDefaults(info).database}
                        onChange={(event) => setDatabase(event.target.value)}
                      />
                      {kind === "mssql" && (
                        <label className="flex items-center justify-between gap-3 text-xs font-medium">
                          <span className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-2">
                              <LockKeyhole className="size-4 text-muted-foreground" />{" "}
                              Windows-Authentifizierung
                            </span>
                            <span className="font-normal text-muted-foreground">
                              Meldet mit dem angemeldeten Windows-Konto an.
                            </span>
                          </span>
                          <Switch
                            checked={trusted}
                            onCheckedChange={setTrusted}
                            aria-label="Windows-Authentifizierung"
                          />
                        </label>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <ConnectionField
                          id="connection-user"
                          label={windowsAuth ? "Benutzer (optional)" : "Benutzer"}
                          value={user}
                          onChange={(event) => setUser(event.target.value)}
                        />
                        <ConnectionField
                          id="connection-password"
                          label={windowsAuth ? "Passwort (optional)" : "Passwort"}
                          type="password"
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  {mode === "string" && value.trim() ? (
                    <p className="truncate text-[11px] text-muted-foreground">
                      Erkannt: {quickInfo.name}
                    </p>
                  ) : null}
                  {kind === "oracle" && mode === "string" && (
                    <p className="text-[11px] text-muted-foreground">
                      Oracle geht auch als Key-Value: User Id=scott;Password=tiger;Data
                      Source=host:1521/service
                    </p>
                  )}
                  {poolerWarning && (
                    <p
                      role="status"
                      className="min-w-0 break-words rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300"
                    >
                      Du nutzt einen Transaction Pooler. Für den vollständigen SQL-Arbeitsplatz
                      nutze eine direkte Verbindung oder den Session Pooler auf Port 5432.
                    </p>
                  )}
                  <ConnectionAdvancedOptions
                    caps={caps}
                    defaultOpen={advancedOpen}
                    ssl={ssl}
                    onSsl={setSsl}
                    readOnly={readOnly}
                    onReadOnly={setReadOnly}
                    sshEnabled={sshEnabled}
                    onSshEnabled={setSshEnabled}
                    sshHost={sshHost}
                    onSshHost={setSshHost}
                    sshPort={sshPort}
                    onSshPort={setSshPort}
                    sshUser={sshUser}
                    onSshUser={setSshUser}
                    sshAuth={sshAuth}
                    onSshAuth={setSshAuth}
                    sshKey={sshKey}
                    onSshKey={setSshKey}
                    sshPassword={sshPassword}
                    onSshPassword={setSshPassword}
                    tags={tags}
                    onTags={setTags}
                    color={color}
                    onColor={setColor}
                    schemaFilter={schemaFilter}
                    onSchemaFilter={setSchemaFilter}
                    scannedSchemas={scannedSchemas}
                    scannedUser={scannedUser}
                    scanning={scanning}
                    scanError={scanError}
                    onScan={() => void scanSchemas()}
                    connection={connection}
                  />
                  <div aria-live="polite" className="min-h-8">
                    {result.status === "testing" && (
                      <AnimatedBadge status="loading" size="sm">
                        Verbindung wird geprüft{elapsed > 0 ? ` · ${elapsed} s` : ""}
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
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <LockKeyhole className="size-3" />
                    Passwörter bleiben im System-Schlüsselbund
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </fieldset>
        <footer
          data-tour="connection-save"
          className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/50 px-4 py-3"
        >
          <Button
            type="button"
            variant="ghost"
            disabled={busy || step === 1 || !guided}
            onClick={() => setStep(1)}
          >
            Zurück
          </Button>
          {step === 1 ? (
            <Button
              type="button"
              disabled={busy || !info.driver_status.available}
              onClick={() => {
                requestAnimationFrame(() => setStep(2));
              }}
            >
              Weiter
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void test()}>
                <PlugZap className="size-4" />
                Testen
              </Button>
              <SlideActionButton
                className={busy ? "h-11 w-60 pointer-events-none opacity-70" : "h-11 w-60"}
                completeLabel="Gespeichert"
                onComplete={() => void save()}
              >
                Speichern
              </SlideActionButton>
            </div>
          )}
        </footer>
      </form>
    </section>
  );
}
