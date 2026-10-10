import {
  syncBackupLoad,
  syncBackupSave,
  syncBegin,
  syncCancel,
  syncDecrypt,
  syncEncrypt,
  syncEnd,
  syncFetch,
  syncOpenSecrets,
  syncSealSecrets,
  syncStore,
} from "@/lib/db/sync";
import {
  runSync,
  type SyncDecider,
  type SyncDeps,
  type SyncMode,
  type SyncOutcome,
} from "./engine";
import { applyLocal, collectLocal, forgetCachedSecrets, secretAccounts } from "./local";
import {
  buildSnapshot,
  type ChangeSummary,
  diffSnapshots,
  documentSnapshot,
  parseDocument,
  SYNC_COLLECTIONS,
  type SyncCollection,
  snapshotCollections,
  summaryTotal,
  toDocument,
} from "./payload";
import { readSyncBase, syncTarget, useSyncStore, writeSyncBase } from "./store";

export const syncDeps: SyncDeps = {
  transport: {
    begin: syncBegin,
    end: syncEnd,
    fetch: syncFetch,
    store: syncStore,
    cancel: syncCancel,
    encrypt: syncEncrypt,
    decrypt: syncDecrypt,
    sealSecrets: syncSealSecrets,
    openSecrets: syncOpenSecrets,
    backup: syncBackupSave,
  },
  local: {
    collect: collectLocal,
    apply: applyLocal,
    secretAccounts,
    forgetSecrets: forgetCachedSecrets,
  },
  readBase: readSyncBase,
  writeBase: writeSyncBase,
  now: () => Date.now(),
};

let running: Promise<SyncOutcome> | null = null;

export function syncInProgress(): boolean {
  return running !== null;
}

function describe(outcome: SyncOutcome, mode: SyncMode): string {
  if (outcome.status === "conflict")
    return `${outcome.conflicts} Konflikt(e) – bitte manuell synchronisieren.`;
  if (outcome.status === "cancelled") return "Abgebrochen.";
  const parts: string[] = [];
  if (outcome.applied)
    parts.push(`${summaryTotal(outcome.applied)} lokale Änderung(en) übernommen`);
  if (outcome.uploaded) parts.push(mode === "upload" ? "hochgeladen" : "Remote aktualisiert");
  if (outcome.secretsUpdated) parts.push(`${outcome.secretsUpdated} Secret(s) aktualisiert`);
  if (parts.length === 0) return "Keine Änderungen.";
  return `${parts.join(", ")}.`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function performSync(
  mode: SyncMode,
  decider: SyncDecider,
  signal?: AbortSignal,
  deps: SyncDeps = syncDeps,
): Promise<SyncOutcome> {
  if (running) throw new Error("Es läuft bereits eine Synchronisierung.");
  const state = useSyncStore.getState();
  const target = syncTarget(state);
  if (!target) throw new Error("Synchronisierung ist nicht eingerichtet.");
  state.report({ lastStatus: "running", lastError: null });
  const task = runSync(deps, {
    mode,
    target,
    settings: {
      includeHistory: state.includeHistory,
      includeSecrets: state.includeSecrets,
      encryptAll: state.encryptAll,
    },
    memory: { deviceId: state.deviceId, lastSalt: state.lastSalt },
    decider,
    signal,
  });
  running = task;
  try {
    const outcome = await task;
    const finished = outcome.status === "ok" || outcome.status === "skipped";
    useSyncStore.getState().report({
      lastStatus: outcome.status === "cancelled" ? "idle" : outcome.status,
      lastMessage: describe(outcome, mode),
      lastError: null,
      ...(finished
        ? {
            lastSyncAt: deps.now(),
            lastVersion: outcome.version,
            lastContentHash: outcome.contentHash,
            lastSalt: outcome.salt,
          }
        : {}),
      ...(outcome.gistId && outcome.gistId !== state.gistId ? { gistId: outcome.gistId } : {}),
    });
    return outcome;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    useSyncStore.getState().report({
      lastStatus: aborted ? "idle" : "error",
      lastError: aborted ? null : errorMessage(error),
      lastMessage: aborted ? "Abgebrochen." : null,
    });
    throw error;
  } finally {
    running = null;
  }
}

export const autoDecider: SyncDecider = {
  conflicts: async () => null,
  preview: async () => true,
};

export async function restoreBackup(id: string): Promise<ChangeSummary> {
  const document = parseDocument(await syncBackupLoad(id));
  const include = new Set<SyncCollection>(
    SYNC_COLLECTIONS.filter((collection) => document.items[collection] !== undefined),
  );
  const snapshot = documentSnapshot(document);
  const current = buildSnapshot(collectLocal(include.has("history")), new Map(), Date.now());
  const summary = diffSnapshots(current, snapshot);
  for (const collection of SYNC_COLLECTIONS)
    if (!include.has(collection)) summary[collection] = { added: 0, updated: 0, removed: 0 };
  await syncBackupSave(
    JSON.stringify(
      toDocument(current, {
        deviceId: useSyncStore.getState().deviceId,
        updatedAt: Date.now(),
        contentHash: "",
        secrets: null,
        include,
      }),
    ),
    "restore",
  );
  applyLocal(snapshotCollections(snapshot), include);
  return summary;
}
