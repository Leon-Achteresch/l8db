import type {
  SyncBackupInfo,
  SyncRemoteFile,
  SyncSealed,
  SyncStoreResult,
  SyncTarget,
} from "@/lib/db/sync";
import {
  type ConflictStrategy,
  mergeSnapshots,
  resolveConflicts,
  type SyncConflict,
} from "./merge";
import {
  buildSnapshot,
  type ChangeSummary,
  contentHash,
  type DevicePathHint,
  diffSnapshots,
  documentSnapshot,
  emptySnapshot,
  isEncryptedDocument,
  type LocalCollections,
  type LocalItem,
  parseDocument,
  parseEnvelope,
  SYNC_COLLECTIONS,
  type SyncBase,
  type SyncCollection,
  type SyncDocument,
  type SyncSnapshot,
  snapshotBase,
  snapshotCollections,
  splitKey,
  summaryTotal,
  toDocument,
} from "./payload";

export type SyncMode = "sync" | "upload" | "download";

export interface SyncTransport {
  begin(): Promise<boolean>;
  end(): Promise<void>;
  fetch(target: SyncTarget, opId: string): Promise<SyncRemoteFile>;
  store(
    target: SyncTarget,
    content: string,
    ifMatch: string | null,
    expectAbsent: boolean,
    opId: string,
  ): Promise<SyncStoreResult>;
  cancel(opId: string): Promise<boolean>;
  encrypt(plaintext: string, salt: string | null): Promise<SyncSealed>;
  decrypt(envelope: string): Promise<string>;
  sealSecrets(accounts: string[], salt: string | null): Promise<SyncSealed | null>;
  openSecrets(envelope: string, accounts: string[]): Promise<string[]>;
  backup(content: string, reason: string): Promise<SyncBackupInfo>;
}

export interface SyncLocal {
  collect(includeHistory: boolean): LocalCollections;
  apply(collections: LocalCollections, include: ReadonlySet<SyncCollection>): void;
  secretAccounts(items: LocalItem[]): string[];
  forgetSecrets(accounts: string[]): void;
}

export interface SyncDeps {
  transport: SyncTransport;
  local: SyncLocal;
  readBase(): SyncBase;
  writeBase(base: SyncBase): void;
  now(): number;
}

export interface SyncSettings {
  includeHistory: boolean;
  includeSecrets: boolean;
  encryptAll: boolean;
}

export interface SyncMemory {
  deviceId: string;
  lastSalt: string | null;
}

export type SyncDecision =
  | { kind: "conflicts"; conflicts: SyncConflict[] }
  | {
      kind: "preview";
      mode: SyncMode;
      summary: ChangeSummary;
      devicePaths: DevicePathHint[];
      remoteDevice: string | null;
      remoteUpdatedAt: number | null;
    };

export interface SyncDecider {
  conflicts(conflicts: SyncConflict[]): Promise<ConflictStrategy | null>;
  preview(decision: Extract<SyncDecision, { kind: "preview" }>): Promise<boolean>;
}

export interface SyncOutcome {
  status: "ok" | "skipped" | "cancelled" | "conflict";
  uploaded: boolean;
  applied: ChangeSummary | null;
  backup: SyncBackupInfo | null;
  version: string | null;
  gistId: string | null;
  contentHash: string | null;
  salt: string | null;
  conflicts: number;
  secretsUpdated: number;
}

export class SyncAbortedError extends Error {
  constructor() {
    super("Synchronisierung abgebrochen.");
    this.name = "AbortError";
  }
}

export class SyncBusyError extends Error {
  constructor() {
    super("Eine Synchronisierung läuft bereits in einem anderen Fenster.");
    this.name = "SyncBusyError";
  }
}

export class SyncRemoteChangedError extends Error {
  constructor() {
    super(
      "Die Remote-Datei wurde während der Synchronisierung geändert. Bitte erneut synchronisieren.",
    );
    this.name = "SyncRemoteChangedError";
  }
}

export function includedCollections(settings: SyncSettings): Set<SyncCollection> {
  return new Set(
    SYNC_COLLECTIONS.filter((collection) => collection !== "history" || settings.includeHistory),
  );
}

function envelopeSalt(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  try {
    const salt = (JSON.parse(envelope) as { kdf?: { salt?: unknown } }).kdf?.salt;
    return typeof salt === "string" ? salt : null;
  } catch {
    return null;
  }
}

function restrict(base: SyncBase, include: ReadonlySet<SyncCollection>): SyncBase {
  const next: SyncBase = new Map();
  for (const [key, value] of base) if (include.has(splitKey(key).collection)) next.set(key, value);
  return next;
}

function passThrough(
  target: SyncSnapshot,
  source: SyncSnapshot,
  include: ReadonlySet<SyncCollection>,
): void {
  for (const [key, entry] of source.items)
    if (!include.has(splitKey(key).collection)) target.items.set(key, entry);
  for (const [key, deletedAt] of source.tombstones)
    if (!include.has(splitKey(key).collection)) target.tombstones.set(key, deletedAt);
}

function connectionItems(snapshot: SyncSnapshot): LocalItem[] {
  return snapshotCollections(snapshot).connections;
}

function opIdentifier(now: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `sync-${now}-${random}`;
}

export function changedPathHints(
  merged: SyncSnapshot,
  local: SyncSnapshot,
  hints: DevicePathHint[],
): DevicePathHint[] {
  return hints.filter((hint) => {
    const key = `${hint.collection}:${hint.id}`;
    return merged.items.get(key)?.hash !== local.items.get(key)?.hash;
  });
}

export async function decodeRemote(
  transport: Pick<SyncTransport, "decrypt">,
  content: string,
): Promise<{ document: SyncDocument; salt: string | null }> {
  const envelope = parseEnvelope(content);
  if (!isEncryptedDocument(envelope))
    return { document: envelope, salt: envelopeSalt(envelope.secrets) };
  const plain = await transport.decrypt(envelope.encrypted);
  const document = parseDocument(plain);
  return { document, salt: envelopeSalt(envelope.encrypted) ?? envelopeSalt(document.secrets) };
}

export async function runSync(
  deps: SyncDeps,
  options: {
    mode: SyncMode;
    target: SyncTarget;
    settings: SyncSettings;
    memory: SyncMemory;
    decider: SyncDecider;
    signal?: AbortSignal;
  },
): Promise<SyncOutcome> {
  const { mode, target, settings, memory, decider, signal } = options;
  const opId = opIdentifier(deps.now());
  const check = () => {
    if (signal?.aborted) throw new SyncAbortedError();
  };
  const onAbort = () => void deps.transport.cancel(opId).catch(() => false);
  check();
  signal?.addEventListener("abort", onAbort, { once: true });
  const outcome: SyncOutcome = {
    status: "ok",
    uploaded: false,
    applied: null,
    backup: null,
    version: null,
    gistId: target.provider === "gist" ? target.gistId : null,
    contentHash: null,
    salt: memory.lastSalt,
    conflicts: 0,
    secretsUpdated: 0,
  };
  let leased = false;
  try {
    leased = await deps.transport.begin();
    if (!leased) throw new SyncBusyError();
    check();
    const include = includedCollections(settings);
    const base = deps.readBase();
    const now = deps.now();
    const local = buildSnapshot(
      deps.local.collect(settings.includeHistory),
      restrict(base, include),
      now,
    );
    let remoteFile: SyncRemoteFile | null = null;
    let remoteDocument: SyncDocument | null = null;
    let remote: SyncSnapshot = emptySnapshot();
    if (mode !== "upload") {
      remoteFile = await deps.transport.fetch(target, opId);
      check();
      if (remoteFile.gistId) outcome.gistId = remoteFile.gistId;
      if (remoteFile.content) {
        const decoded = await decodeRemote(deps.transport, remoteFile.content);
        check();
        remoteDocument = decoded.document;
        outcome.salt = decoded.salt ?? outcome.salt;
        remote = documentSnapshot(remoteDocument);
      }
      passThrough(local, remote, include);
    }
    let merged: SyncSnapshot;
    if (mode === "download") {
      if (!remoteDocument) throw new Error("Auf dem Server liegen noch keine Sync-Daten.");
      merged = remote;
    } else if (mode === "upload") {
      merged = local;
    } else {
      const result = mergeSnapshots(local, remote, base);
      outcome.conflicts = result.conflicts.length;
      if (result.conflicts.length > 0) {
        const strategy = await decider.conflicts(result.conflicts);
        check();
        if (!strategy) return { ...outcome, status: "conflict" };
        merged = resolveConflicts(result, strategy, now);
      } else merged = result.merged;
    }
    const summary = diffSnapshots(local, merged);
    for (const collection of SYNC_COLLECTIONS)
      if (!include.has(collection)) summary[collection] = { added: 0, updated: 0, removed: 0 };
    if (summaryTotal(summary) > 0) {
      const accepted = await decider.preview({
        kind: "preview",
        mode,
        summary,
        devicePaths: changedPathHints(merged, local, remoteDocument?.hints.devicePaths ?? []),
        remoteDevice: remoteDocument?.deviceId ?? null,
        remoteUpdatedAt: remoteDocument?.updatedAt ?? null,
      });
      check();
      if (!accepted) return { ...outcome, status: "cancelled" };
      const snapshotDocument = toDocument(local, {
        deviceId: memory.deviceId,
        updatedAt: now,
        contentHash: "",
        secrets: null,
        include,
      });
      outcome.backup = await deps.transport.backup(JSON.stringify(snapshotDocument), mode);
      check();
      deps.local.apply(snapshotCollections(merged), include);
      outcome.applied = summary;
    }
    const accounts = settings.includeSecrets
      ? deps.local.secretAccounts(connectionItems(merged))
      : [];
    if (settings.includeSecrets && remoteDocument?.secrets && mode !== "upload") {
      const updated = await deps.transport.openSecrets(remoteDocument.secrets, accounts);
      deps.local.forgetSecrets(updated);
      outcome.secretsUpdated = updated.length;
      check();
    }
    if (mode === "download") {
      outcome.contentHash = remoteDocument?.contentHash ?? null;
      outcome.version = remoteFile?.version ?? null;
      deps.writeBase(snapshotBase(merged));
      return outcome;
    }
    const sealed =
      settings.includeSecrets && accounts.length > 0
        ? await deps.transport.sealSecrets(accounts, outcome.salt)
        : null;
    check();
    if (sealed) outcome.salt = sealed.salt;
    const hash = await contentHash(merged, sealed?.fingerprint ?? null);
    outcome.contentHash = hash;
    outcome.version = remoteFile?.version ?? null;
    const unchanged =
      mode === "sync" && remoteDocument !== null && remoteDocument.contentHash === hash;
    if (!unchanged) {
      const document = toDocument(merged, {
        deviceId: memory.deviceId,
        updatedAt: now,
        contentHash: hash,
        secrets: sealed?.envelope ?? null,
      });
      let body = JSON.stringify(document);
      if (settings.encryptAll) {
        const wrapped = await deps.transport.encrypt(body, outcome.salt);
        check();
        outcome.salt = wrapped.salt;
        body = JSON.stringify({
          format: document.format,
          schemaVersion: document.schemaVersion,
          deviceId: document.deviceId,
          updatedAt: document.updatedAt,
          contentHash: hash,
          encrypted: wrapped.envelope,
        });
      }
      const stored = await deps.transport.store(
        target.provider === "gist" && outcome.gistId
          ? { ...target, gistId: outcome.gistId }
          : target,
        body,
        mode === "sync" ? (remoteFile?.version ?? null) : null,
        mode === "sync" && !remoteFile?.content,
        opId,
      );
      if (stored.conflict) throw new SyncRemoteChangedError();
      outcome.uploaded = true;
      outcome.version = stored.version;
      if (stored.gistId) outcome.gistId = stored.gistId;
    } else if (outcome.applied === null) outcome.status = "skipped";
    deps.writeBase(snapshotBase(merged));
    return outcome;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (leased) await deps.transport.end().catch(() => undefined);
  }
}
