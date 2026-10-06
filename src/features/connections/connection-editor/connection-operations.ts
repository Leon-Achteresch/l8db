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
  storeSecret,
} from "@/lib/secrets";
import {
  activateConnection,
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
  vault: { host: ExtensionManager; name: string } | null;
  onSaved: () => void;
}

export async function databasePasswordToSave(
  connectionString: string,
  connection: Pick<SavedConnection, "id" | "connectionString"> | undefined,
): Promise<string | null> {
  const typed = extractUrlPassword(connectionString);
  if (typed !== null || !connection) return typed;
  if (extractUrlPassword(connection.connectionString) !== null) return null;
  return loadSecret(connection.id);
}

export async function closeUnsharedTunnel(id: string): Promise<void> {
  const shared = await connectionInOtherWindow(id).catch(() => false);
  if (!shared) await closeSshTunnel(id).catch(() => undefined);
}

export function createConnectionOperations(ctx: ConnectionOperationsContext) {
  const {
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
    cloudAuth,
    vault,
    onSaved,
  } = ctx;

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
      const dbPassword = await databasePasswordToSave(config.connectionString, connection);
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
      const jumpSecrets = config.ssh ? serializeJumpSecrets(config.secrets.jumps) : null;
      const networkSecrets: [string, string | null][] = [
        [sshJumpSecretAccount(id), jumpSecrets],
        [proxySecretAccount(id), config.proxy ? config.secrets.proxy : null],
      ];
      for (const [account, value] of networkSecrets) {
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
      if (usesTunnel(connection)) await closeUnsharedTunnel(id);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === id });
      const input = {
        name: name.trim(),
        kind: config.kind,
        connectionString: config.connectionString,
        sslMode: ssl,
        ssh: config.ssh,
        proxy: config.proxy,
        commandTunnel: config.commandTunnel,
        tunnelPort: null,
        favorite: connection?.favorite ?? false,
        readOnly: readOnly && configInfo.capabilities.read_only_mode,
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

  return { test, scanSchemas, save };
}
