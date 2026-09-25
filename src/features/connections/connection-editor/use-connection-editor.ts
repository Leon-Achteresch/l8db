import { useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { initialSslMode } from "@/lib/connection-defaults";
import { detectProvider, kindFromUrl } from "@/lib/connection-url";
import type { ConnectionEnvironment, SshAuth } from "@/lib/connections";
import { oracleTnsNames, type SslMode } from "@/lib/db";
import { useDbThemeStore } from "@/lib/db-theme";
import type { MaskRule } from "@/lib/masking";
import { useProvidersStore } from "@/lib/providers";
import { loadSecret, withSslModeParam } from "@/lib/secrets";
import { useSettingsStore } from "@/lib/settings";
import type { SshConfigDraft } from "@/lib/ssh";
import { createConnectionInputActions } from "./connection-input-actions";
import { createConnectionOperations } from "./connection-operations";
import { createConnectionUrlActions } from "./connection-url-actions";
import { seedFields, seedMode } from "./seed";
import type { ConnectionEditorProps, Mode, TestResult } from "./types";
import { jumpHostDraft, useNetworkDraft } from "./use-network-draft";

export function useConnectionEditor({
  connection,
  template,
  onSaved,
}: Omit<ConnectionEditorProps, "onCancel">) {
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
  const network = useNetworkDraft(seed, connection?.id);
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
  const [environment, setEnvironment] = useState<ConnectionEnvironment | null>(
    seed?.environment ?? null,
  );
  const [maskRules, setMaskRules] = useState<MaskRule[]>(seed?.maskRules ?? []);
  const [schemaFilter, setSchemaFilter] = useState<string[]>(seed?.schemas ?? []);
  const [showSingleSchemaSwitcher, setShowSingleSchemaSwitcher] = useState(
    seed?.showSingleSchemaSwitcher ?? true,
  );
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
    seed?.ssh?.host ||
      seed?.proxy?.host ||
      seed?.readOnly ||
      seed?.schemas?.length ||
      seed?.color ||
      seed?.environment ||
      seed?.maskRules?.length ||
      seed?.tags?.length,
  );

  function applySshConfig(draft: SshConfigDraft) {
    setSshEnabled(true);
    setSshHost(draft.host);
    setSshPort(String(draft.port));
    setSshUser(draft.user);
    setSshAuth(draft.auth);
    setSshKey(draft.keyFile);
    network.setSshAgentSocket(draft.agentSocket);
    network.setJumpHosts(draft.jumpHosts.map(jumpHostDraft));
  }

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

  const { makeUrl, configuration, withLiveUrl } = createConnectionUrlActions({
    mode,
    value,
    kind,
    providers,
    info,
    ssl,
    file,
    tnsAlias,
    user,
    password,
    host,
    port,
    database,
    extraParams,
    windowsAuth,
    withSsl,
    sshEnabled,
    sshPort,
    sshHost,
    sshUser,
    sshAuth,
    sshKey,
    sshPassword,
    network,
    connection,
  });

  const { test, scanSchemas, save } = createConnectionOperations({
    operation,
    setResult,
    withLiveUrl,
    configuration,
    setScanning,
    setScanError,
    setScannedUser,
    setScannedSchemas,
    setSaving,
    name,
    providers,
    info,
    connection,
    queryClient,
    ssl,
    readOnly,
    schemaFilter,
    showSingleSchemaSwitcher,
    color,
    environment,
    maskRules,
    tags,
    onSaved,
  });

  const { selectProvider, pasteConnectionString, switchMode, pickFile } =
    createConnectionInputActions({
      providers,
      mode,
      setProvider,
      setMode,
      setPreview,
      setResult,
      setHost,
      setPort,
      setDatabase,
      setUser,
      setPassword,
      setExtraParams,
      setTrusted,
      setFile,
      setTnsAlias,
      setValue,
      value,
      setSsl,
      step,
      setStep,
      kind,
      info,
      makeUrl,
    });

  const databaseLabel =
    kind === "oracle"
      ? "Service-Name"
      : kind === "cassandra"
        ? "Keyspace"
        : kind === "redis"
          ? "Datenbank-Nummer"
          : "Datenbank";
  const activeInfo = mode === "string" ? quickInfo : info;

  return {
    activeInfo,
    advancedOpen,
    applySshConfig,
    busy,
    caps,
    color,
    database,
    databaseLabel,
    environment,
    maskRules,
    setEnvironment,
    setMaskRules,
    elapsed,
    file,
    groups,
    guided,
    host,
    info,
    initial,
    kind,
    mode,
    name,
    network,
    password,
    pasteConnectionString,
    pickFile,
    poolerWarning,
    port,
    provider,
    providers,
    quickInfo,
    quickKind,
    quickProviderId,
    readOnly,
    reduce,
    result,
    save,
    scanError,
    scanSchemas,
    scannedSchemas,
    scannedUser,
    scanning,
    schemaFilter,
    showSingleSchemaSwitcher,
    selectProvider,
    setColor,
    setDatabase,
    setFile,
    setHost,
    setName,
    setPassword,
    setPort,
    setProvider,
    setReadOnly,
    setResult,
    setSchemaFilter,
    setShowSingleSchemaSwitcher,
    setShowPassword,
    setSshAuth,
    setSshEnabled,
    setSshHost,
    setSshKey,
    setSshPassword,
    setSshPort,
    setSshUser,
    setSsl,
    setStep,
    setTags,
    setTns,
    setTnsAlias,
    setTrusted,
    setUser,
    setValue,
    showPassword,
    sshAuth,
    sshEnabled,
    sshHost,
    sshKey,
    sshPassword,
    sshPort,
    sshUser,
    ssl,
    step,
    switchMode,
    tags,
    test,
    tns,
    tnsAlias,
    trusted,
    user,
    value,
    windowsAuth,
  };
}
