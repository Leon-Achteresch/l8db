import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { errorText, vaultSave } from "@/features/community-extensions/password-manager";
import { connectionError } from "@/lib/connection-url";
import {
  type CloudAuth,
  type ConnectionEnvironment,
  type SavedConnection,
  useConnectionsStore,
  usesTunnel,
} from "@/lib/connections";
import {
  connectionInOtherWindow,
  listSchemas,
  type ProviderInfo,
  type SslMode,
  testConnectionString,
} from "@/lib/db";
import type { ExtensionManager } from "@/lib/extensions/manager";
import type { MaskRule } from "@/lib/masking";
import {
  deleteSecret,
  extractUrlPassword,
  loadSecret,
  rememberSecret,
  scrubUrlPassword,
  storeSecret,
} from "@/lib/secrets";
import {
  activateConnection,
  activateConnectionWithToast,
  closeSshTunnel,
  proxySecretAccount,
  serializeJumpSecrets,
  sshJumpSecretAccount,
  sshSecretAccount,
} from "@/lib/ssh";
import type { createConnectionUrlActions } from "./connection-url-actions";
import type { TestResult } from "./types";

type ConnectionUrlActions = ReturnType<typeof createConnectionUrlActions>;

export interface ConnectionOperationsContext {
  operation: MutableRefObject<boolean>;
  abort: MutableRefObject<AbortController | null>;
  setResult: (value: TestResult) => void;
  withLiveUrl: ConnectionUrlActions["withLiveUrl"];
  configuration: ConnectionUrlActions["configuration"];
  setScanning: (value: boolean) => void;
  setScanError: (value: string | null) => void;
  setScannedUser: (value: string) => void;
  setScannedSchemas: (value: string[]) => void;
  setSaving: (value: boolean) => void;
  name: string;
  providers: ProviderInfo[];
  info: ProviderInfo;
  connection: SavedConnection | undefined;
  queryClient: QueryClient;
  ssl: SslMode;
  readOnly: boolean;
  schemaFilter: string[];
  showSingleSchemaSwitcher: boolean;
  color: string | null;
  environment: ConnectionEnvironment | null;
  maskRules: MaskRule[];
  tags: string;
  cloudAuth: CloudAuth | null;
  passwordCleared: boolean;
  vault: { host: ExtensionManager; name: string } | null;
  onSaved: () => void;
}

export async function databasePasswordToSave(
  connectionString: string,
  connection: Pick<SavedConnection, "id" | "connectionString"> | undefined,
  cleared = false,
): Promise<string | null> {
  const typed = extractUrlPassword(connectionString);
  if (typed !== null || !connection || cleared) return typed;
  if (extractUrlPassword(connection.connectionString) !== null) return null;
  return loadSecret(connection.id);
}

const ENDPOINT_FIELDS = [
  "kind",
  "connectionString",
  "sslMode",
  "ssh",
  "proxy",
  "commandTunnel",
  "readOnly",
  "cloudAuth",
  "environment",
] as const;

export function endpointChanged(
  previous: Partial<SavedConnection>,
  next: Partial<SavedConnection>,
): boolean {
  return ENDPOINT_FIELDS.some((key) => {
    const normalize = (value: unknown) =>
      key === "connectionString"
        ? scrubUrlPassword(String(value ?? ""))
        : JSON.stringify(value ?? (key === "readOnly" ? false : null));
    return normalize(previous[key]) !== normalize(next[key]);
  });
}

export async function closeUnsharedTunnel(id: string): Promise<void> {
  const shared = await connectionInOtherWindow(id).catch(() => false);
  if (!shared) await closeSshTunnel(id).catch(() => undefined);
}

export function createConnectionOperations(ctx: ConnectionOperationsContext) {
  const {
    operation,
    abort,
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
    cloudAuth,
    passwordCleared,
    vault,
    onSaved,
  } = ctx;

  async function test() {
    if (operation.current) return;
    operation.current = true;
    setResult({ status: "testing" });
    const controller = new AbortController();
    abort.current = controller;
    const started = performance.now();
    try {
      await withLiveUrl((liveKind, url) => testConnectionString(liveKind, url), controller.signal);
      setResult({ status: "success", ms: Math.round(performance.now() - started) });
    } catch (error) {
      setResult(
        controller.signal.aborted
          ? { status: "idle" }
          : { status: "error", message: connectionError(error) },
      );
    } finally {
      abort.current = null;
      operation.current = false;
    }
  }

  function cancelTest() {
    abort.current?.abort();
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
      const dbPassword = await databasePasswordToSave(
        config.connectionString,
        connection,
        passwordCleared,
      );
      const wasActive = Boolean(connection) && useConnectionsStore.getState().activeId === id;
      const desiredSecrets: [string, string | null][] = [
        [id, dbPassword],
        [sshSecretAccount(id), config.ssh && config.secret ? config.secret : null],
        [sshJumpSecretAccount(id), config.ssh ? serializeJumpSecrets(config.secrets.jumps) : null],
        [proxySecretAccount(id), config.proxy ? config.secrets.proxy : null],
      ];
      let reconnect = false;
      if (connection && wasActive) {
        const stored = await Promise.all(
          desiredSecrets.map(([account]) => loadSecret(account).catch(() => null)),
        );
        reconnect =
          endpointChanged(connection, {
            ...config,
            sslMode: ssl,
            readOnly,
            cloudAuth,
            environment,
          }) ||
          desiredSecrets.some(([, value], index) => (value || null) !== (stored[index] || null));
        if (reconnect) {
          const outcome = await activateConnection(null);
          if (!outcome.ok) throw new Error(outcome.error);
        }
      }
      const keepConnected = wasActive && !reconnect;
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
      for (const [account, value] of desiredSecrets.slice(2)) {
        if (value) {
          await storeSecret(account, value).catch(() =>
            toast.warning(
              "Netzwerk-Zugangsdaten gelten nur in dieser Sitzung: Schlüsselbund nicht verfügbar.",
            ),
          );
        } else if (connection) {
          await deleteSecret(account).catch(() => undefined);
        }
      }
      if (keepConnected)
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === id });
      else {
        if (usesTunnel(connection)) await closeUnsharedTunnel(id);
        queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === id });
      }
      const input = {
        name: name.trim(),
        kind: config.kind,
        connectionString: config.connectionString,
        sslMode: ssl,
        ssh: config.ssh,
        proxy: config.proxy,
        commandTunnel: config.commandTunnel,
        tunnelPort: keepConnected ? (connection?.tunnelPort ?? null) : null,
        favorite: connection?.favorite ?? false,
        readOnly,
        cloudAuth,
        schemas: configInfo.capabilities.schemas && schemaFilter.length ? schemaFilter : null,
        showSingleSchemaSwitcher,
        color,
        environment,
        vault: connection?.vault,
        maskRules: maskRules.filter((rule) => rule.pattern.trim()),
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
      if (reconnect) void activateConnectionWithToast(id);
      if (vault) {
        const stored = vaultSave(vault.host, id).then(async () => {
          useConnectionsStore.setState((state) => ({
            connections: state.connections.map((entry) =>
              entry.id === id ? { ...entry, vault: true } : entry,
            ),
          }));
          if (dbPassword) await rememberSecret(id, dbPassword).catch(() => undefined);
        });
        toast.promise(stored, {
          loading: `Speichere in ${vault.name} …`,
          success: `In ${vault.name} gespeichert`,
          error: (error) => `Nicht in ${vault.name} gespeichert: ${errorText(error)}`,
        });
      }
      onSaved();
    } catch (error) {
      setResult({ status: "error", message: connectionError(error) });
    } finally {
      setSaving(false);
      operation.current = false;
    }
  }

  return { test, cancelTest, scanSchemas, save };
}
