import { useBackupToolPaths } from "@/lib/backup-runner";
import { stripConnectionSecrets } from "@/lib/connection-export/export";
import {
  cloudAuthConnectionString,
  type SavedConnection,
  useConnectionsStore,
} from "@/lib/connections";
import { isReadOnlyConnection } from "@/lib/connections/secrets";
import {
  type AutomationConnection,
  getAutomationSettings,
  saveAutomationSettings,
  syncAutomationConnections,
} from "@/lib/db/automation";
import { connectionEnvironment, isProductionLocked } from "@/lib/environments";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { proxyUserConnectionString, readOnlyConnectionString } from "@/lib/ssh/connection-string";
import { subscribeAutomationEvents } from "./store";
import { initAutomationTaskBridge } from "./task-bridge";

export const AUTOMATION_SYNC_DEBOUNCE_MS = 500;

function serverReadOnly(connection: SavedConnection): boolean {
  return (
    isReadOnlyConnection(connection) ||
    (isProductionLocked(connection) && capabilitiesFor(connection.kind).read_only_mode)
  );
}

function cleanConnectionString(connection: SavedConnection, readOnly: boolean): string {
  const raw = stripConnectionSecrets(connection.connectionString);
  let value = raw;
  if (readOnly && raw.includes("://")) {
    try {
      value = readOnlyConnectionString(raw);
    } catch {
      value = raw;
    }
  }
  return cloudAuthConnectionString(proxyUserConnectionString(value, connection), connection);
}

export function buildAutomationConnection(connection: SavedConnection): AutomationConnection {
  const readOnly = serverReadOnly(connection);
  const ssh = connection.ssh?.host ? connection.ssh : null;
  const proxy = connection.proxy?.host ? connection.proxy : null;
  const command = connection.commandTunnel?.command?.trim() ? connection.commandTunnel : null;
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    connectionString: cleanConnectionString(connection, readOnly),
    readOnly,
    productionLocked: isProductionLocked(connection),
    environment: connectionEnvironment(connection),
    tags: (connection.tags ?? []).map((tag) => tag.name),
    ssh: ssh
      ? {
          host: ssh.host,
          port: ssh.port,
          user: ssh.user,
          auth: ssh.auth,
          keyFile: ssh.keyFile ?? "",
          agentSocket: ssh.agentSocket ?? null,
          jumpHosts: (ssh.jumpHosts ?? []).map((hop) => ({
            host: hop.host,
            port: hop.port,
            user: hop.user,
            auth: hop.auth,
            keyFile: hop.keyFile ?? "",
            agentSocket: hop.agentSocket ?? null,
          })),
          remoteHost: ssh.remoteHost,
          remotePort: ssh.remotePort,
        }
      : null,
    proxy: proxy
      ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username ?? null }
      : null,
    commandTunnel: command
      ? {
          command: command.command.trim(),
          localPort: command.localPort || null,
          timeoutSecs: command.timeoutSecs || null,
        }
      : null,
    vault: Boolean(connection.vault),
  };
}

export function buildAutomationConnections(connections: SavedConnection[]): AutomationConnection[] {
  return connections.filter((connection) => !connection.temporary).map(buildAutomationConnection);
}

let lastSent: string | null = null;

export async function syncAutomationConnectionsNow(): Promise<void> {
  const descriptors = buildAutomationConnections(useConnectionsStore.getState().connections);
  const payload = JSON.stringify(descriptors);
  if (payload === lastSent) return;
  await syncAutomationConnections(descriptors);
  lastSent = payload;
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export async function mirrorAutomationSettings(): Promise<void> {
  const sshTrustNewHosts = useSettingsStore.getState().sshTrustNewHosts;
  const backupToolPaths = useBackupToolPaths.getState().paths;
  const settings = await getAutomationSettings();
  if (
    settings.sshTrustNewHosts === sshTrustNewHosts &&
    sameRecord(settings.backupToolPaths ?? {}, backupToolPaths)
  )
    return;
  await saveAutomationSettings({ ...settings, sshTrustNewHosts, backupToolPaths });
}

function debounced(run: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run().catch(() => undefined);
    }, AUTOMATION_SYNC_DEBOUNCE_MS);
  };
}

let started = false;

export function initAutomationSync(): void {
  if (started) return;
  started = true;
  void initAutomationTaskBridge().catch(() => undefined);
  void subscribeAutomationEvents().catch(() => undefined);
  void syncAutomationConnectionsNow().catch(() => undefined);
  void mirrorAutomationSettings().catch(() => undefined);
  const syncConnections = debounced(syncAutomationConnectionsNow);
  const syncSettings = debounced(mirrorAutomationSettings);
  let connections = useConnectionsStore.getState().connections;
  useConnectionsStore.subscribe((state) => {
    if (state.connections === connections) return;
    connections = state.connections;
    syncConnections();
  });
  let trust = useSettingsStore.getState().sshTrustNewHosts;
  useSettingsStore.subscribe((state) => {
    if (state.sshTrustNewHosts === trust) return;
    trust = state.sshTrustNewHosts;
    syncSettings();
  });
  let paths = useBackupToolPaths.getState().paths;
  useBackupToolPaths.subscribe((state) => {
    if (state.paths === paths) return;
    paths = state.paths;
    syncSettings();
  });
}
