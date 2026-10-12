import type {
  SecretMergeRequest,
  SecretResolution,
  SyncBackupInfo,
  SyncRemoteFile,
  SyncSealed,
  SyncSecretMerge,
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
  DELETED,
  type DevicePathHint,
  diffSnapshots,
  documentSnapshot,
  emptySnapshot,
  hashData,
  hashText,
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
  serializeDocument,
  snapshotBase,
  snapshotCollections,
  splitKey,
  summaryTotal,
  toDocument,
} from "./payload";
import type { StoredSecretBase } from "./store";

export type SyncMode = "sync" | "upload" | "download";

export interface SyncTransport {
  begin(): Promise<string | null>;
  end(token: string): Promise<boolean>;
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
  mergeSecrets(request: SecretMergeRequest): Promise<SyncSecretMerge>;
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
  readSecretBase(): StoredSecretBase;
  writeSecretBase(base: StoredSecretBase): void;
  readSecretEdits(): Record<string, number>;
  now(): number;
}

export interface SyncSettings {
  includeHistory: boolean;
  includeSecrets: boolean;
  purgeRemoteSecrets?: boolean;
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

export interface SecretConflict {
  account: string;
  connectionId: string;
  label: string;
  kind: string;
}

export type SecretResolutions = Record<string, SecretResolution>;

export interface SyncDecider {
  automatic?: boolean;
  conflicts(conflicts: SyncConflict[]): Promise<ConflictStrategy | null>;
  preview(decision: Extract<SyncDecision, { kind: "preview" }>): Promise<boolean>;
  secretConflicts?(conflicts: SecretConflict[]): Promise<SecretResolutions | null>;
}

export type DowngradeReason = "plain" | "undecryptable";

export class SyncDowngradeError extends Error {
  readonly reason: DowngradeReason;
  constructor(reason: DowngradeReason = "plain") {
    super(
      reason === "plain"
        ? "Die Sync-Datei auf dem Server ist vollständig verschlüsselt, auf diesem Rechner ist die Verschlüsselung aber nicht aktiviert. Aktivieren Sie die Verschlüsselung oder bestätigen Sie ausdrücklich, dass die Datei unverschlüsselt überschrieben wird."
        : "Die Sync-Datei auf dem Server kann auf diesem Rechner nicht entschlüsselt werden (Sync-Passphrase fehlt oder ist falsch). Hinterlegen Sie die richtige Passphrase oder bestätigen Sie ausdrücklich, dass die Server-Datei mit allen Daten anderer Rechner überschrieben wird.",
    );
    this.name = "SyncDowngradeError";
    this.reason = reason;
  }
}

const SECRET_KINDS: Record<string, string> = {
  "": "Datenbank-Passwort",
  ":ssh": "SSH-Passwort",
  ":ssh-jumps": "Jump-Host-Passwörter",
  ":proxy": "Proxy-Passwort",
  ":params": "Geheime Parameter",
};

export function describeSecretConflicts(
  accounts: string[],
  connections: LocalItem[],
): SecretConflict[] {
  const names = new Map(
    connections.map((item) => [item.id, (item.data as { name?: string }).name ?? item.id]),
  );
  return accounts.map((account) => {
    const suffix = Object.keys(SECRET_KINDS).find(
      (candidate) => candidate && account.endsWith(candidate),
    );
    const connectionId = suffix ? account.slice(0, -suffix.length) : account;
    return {
      account,
      connectionId,
      label: names.get(connectionId) ?? connectionId,
      kind: SECRET_KINDS[suffix ?? ""],
    };
  });
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
  attempts: number;
  warning: string | null;
  remoteEncrypted: boolean;
  downgradeBlocked: boolean;
  secretConflicts: number;
  secretBackup: string | null;
  committed: boolean;
  remoteHasSecrets: boolean;
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

export const MAX_SYNC_ATTEMPTS = 3;

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new SyncAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SyncAbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function entryState(snapshot: SyncSnapshot, key: string): [string, number] | undefined {
  const entry = snapshot.items.get(key);
  if (entry) return [entry.hash, entry.updatedAt];
  const deletedAt = snapshot.tombstones.get(key);
  return deletedAt === undefined ? undefined : [DELETED, deletedAt];
}

export function agreedBase(base: SyncBase, merged: SyncSnapshot, remote: SyncSnapshot): SyncBase {
  const next: SyncBase = new Map(base);
  const keys = new Set([
    ...merged.items.keys(),
    ...merged.tombstones.keys(),
    ...remote.items.keys(),
    ...remote.tombstones.keys(),
  ]);
  for (const key of keys) {
    const ours = entryState(merged, key);
    const theirs = entryState(remote, key);
    if (ours && theirs && ours[0] === theirs[0]) next.set(key, ours);
  }
  return next;
}

function verifyTaken(merged: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot): void {
  for (const [key, entry] of merged.items) {
    if (local.items.get(key)?.data === entry.data) continue;
    if (remote.items.get(key)?.data !== entry.data) continue;
    const actual = hashData(entry.data);
    if (actual !== entry.hash) merged.items.set(key, { ...entry, hash: actual });
  }
}

function onlyIncluded(snapshot: SyncSnapshot, include: ReadonlySet<SyncCollection>): SyncSnapshot {
  const result = emptySnapshot();
  for (const [key, entry] of snapshot.items)
    if (include.has(splitKey(key).collection)) result.items.set(key, entry);
  for (const [key, deletedAt] of snapshot.tombstones)
    if (include.has(splitKey(key).collection)) result.tombstones.set(key, deletedAt);
  return result;
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
  content: string | ReturnType<typeof parseEnvelope>,
): Promise<{ document: SyncDocument; salt: string | null; encrypted: boolean }> {
  const envelope = typeof content === "string" ? parseEnvelope(content) : content;
  if (!isEncryptedDocument(envelope))
    return { document: envelope, salt: envelopeSalt(envelope.secrets), encrypted: false };
  const plain = await transport.decrypt(envelope.encrypted);
  const document = parseDocument(plain);
  return {
    document,
    salt: envelopeSalt(envelope.encrypted) ?? envelopeSalt(document.secrets),
    encrypted: true,
  };
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
    allowDowngrade?: boolean;
  },
): Promise<SyncOutcome> {
  const { mode, target, signal } = options;
  const opId = opIdentifier(deps.now());
  const onAbort = () => void deps.transport.cancel(opId).catch(() => false);
  if (signal?.aborted) throw new SyncAbortedError();
  signal?.addEventListener("abort", onAbort, { once: true });
  let lease: string | null = null;
  try {
    lease = await deps.transport.begin();
    if (!lease) throw new SyncBusyError();
    if (signal?.aborted) throw new SyncAbortedError();
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await attemptSync(deps, options, opId, attempt);
        return outcome;
      } catch (error) {
        if (
          !(error instanceof SyncRemoteChangedError) ||
          mode === "download" ||
          attempt >= MAX_SYNC_ATTEMPTS
        )
          throw error;
        if (signal?.aborted) throw new SyncAbortedError();
        if (target.provider === "gist" && !target.gistId) throw error;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (lease) await deps.transport.end(lease).catch(() => false);
  }
}

async function attemptSync(
  deps: SyncDeps,
  options: {
    mode: SyncMode;
    target: SyncTarget;
    settings: SyncSettings;
    memory: SyncMemory;
    decider: SyncDecider;
    signal?: AbortSignal;
    allowDowngrade?: boolean;
  },
  opId: string,
  attempt: number,
): Promise<SyncOutcome> {
  const { mode, target, settings, memory, decider, signal } = options;
  const check = () => {
    if (signal?.aborted) throw new SyncAbortedError();
  };
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
    attempts: attempt,
    warning: null,
    remoteEncrypted: false,
    downgradeBlocked: false,
    secretConflicts: 0,
    secretBackup: null,
    committed: false,
    remoteHasSecrets: false,
  };
  const include = includedCollections(settings);
  const base = deps.readBase();
  const now = deps.now();
  const local = buildSnapshot(
    deps.local.collect(settings.includeHistory),
    restrict(base, include),
    now,
  );
  const ownLocal = onlyIncluded(local, include);
  let remoteFile: SyncRemoteFile | null = null;
  let remoteDocument: SyncDocument | null = null;
  let remoteEncrypted = false;
  let remote: SyncSnapshot = emptySnapshot();
  remoteFile = await abortable(deps.transport.fetch(target, opId), signal);
  check();
  if (remoteFile.gistId) outcome.gistId = remoteFile.gistId;
  if (remoteFile.content) {
    const envelope = parseEnvelope(remoteFile.content);
    remoteEncrypted = isEncryptedDocument(envelope);
    outcome.remoteEncrypted = remoteEncrypted;
    if (remoteEncrypted && !settings.encryptAll && mode !== "download" && !options.allowDowngrade) {
      if (decider.automatic) return { ...outcome, status: "conflict", downgradeBlocked: true };
      throw new SyncDowngradeError("plain");
    }
    try {
      const decoded = await abortable(decodeRemote(deps.transport, envelope), signal);
      remoteDocument = decoded.document;
      outcome.salt = decoded.salt ?? outcome.salt;
      remote = documentSnapshot(remoteDocument);
    } catch (error) {
      if (error instanceof SyncAbortedError) throw error;
      if (!remoteEncrypted || mode !== "upload") throw error;
      if (!options.allowDowngrade) throw new SyncDowngradeError("undecryptable");
    }
    check();
  }
  passThrough(local, remote, include);
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
      const strategy = await abortable(decider.conflicts(result.conflicts), signal);
      check();
      if (!strategy) return { ...outcome, status: "conflict" };
      merged = resolveConflicts(result, strategy, now);
    } else merged = result.merged;
  }
  if (mode !== "upload") verifyTaken(merged, local, remote);
  const summary = diffSnapshots(local, merged);
  for (const collection of SYNC_COLLECTIONS)
    if (!include.has(collection)) summary[collection] = { added: 0, updated: 0, removed: 0 };
  if (summaryTotal(summary) > 0) {
    const accepted = await abortable(
      decider.preview({
        kind: "preview",
        mode,
        summary,
        devicePaths: changedPathHints(merged, local, remoteDocument?.hints.devicePaths ?? []),
        remoteDevice: remoteDocument?.deviceId ?? null,
        remoteUpdatedAt: remoteDocument?.updatedAt ?? null,
      }),
      signal,
    );
    check();
    if (!accepted) return { ...outcome, status: "cancelled" };
    const snapshotDocument = toDocument(ownLocal, {
      deviceId: memory.deviceId,
      updatedAt: now,
      contentHash: "",
      secrets: null,
      include,
    });
    outcome.backup = await abortable(
      deps.transport.backup(JSON.stringify(snapshotDocument), mode),
      signal,
    );
    check();
    deps.local.apply(snapshotCollections(merged), include);
    outcome.applied = summary;
  }
  if (mode !== "upload") deps.writeBase(agreedBase(base, merged, remote));
  const accounts = settings.includeSecrets
    ? deps.local.secretAccounts(connectionItems(merged))
    : [];
  let secretBase: StoredSecretBase | null = null;
  let sealed: SyncSealed | null = null;
  if (settings.includeSecrets && accounts.length > 0) {
    const stored = deps.readSecretBase();
    const request = {
      envelope: mode === "upload" ? null : (remoteDocument?.secrets ?? null),
      accounts,
      base: stored.entries,
      keyFingerprint: stored.fingerprint,
      editedAt: deps.readSecretEdits(),
      mode,
      now,
      salt: outcome.salt,
      resolutions: null as SecretResolutions | null,
      backupId: outcome.backup?.id ?? null,
    };
    let secrets = await deps.transport.mergeSecrets(request);
    deps.local.forgetSecrets(secrets.updated);
    check();
    if (secrets.conflicts.length > 0 && decider.secretConflicts) {
      const resolutions = await abortable(
        decider.secretConflicts(
          describeSecretConflicts(secrets.conflicts, connectionItems(merged)),
        ),
        signal,
      );
      check();
      if (resolutions && Object.keys(resolutions).length > 0) {
        const first = secrets;
        secrets = await deps.transport.mergeSecrets({
          ...request,
          resolutions,
          backupId: first.backup ?? request.backupId,
        });
        deps.local.forgetSecrets(secrets.updated);
        check();
        secrets = {
          ...secrets,
          updated: [...new Set([...first.updated, ...secrets.updated])],
          backup: secrets.backup ?? first.backup,
        };
      }
    }
    outcome.secretConflicts = secrets.conflicts.length;
    outcome.secretBackup = secrets.backup;
    deps.local.forgetSecrets(secrets.updated);
    outcome.secretsUpdated = secrets.updated.length;
    if (mode !== "upload")
      deps.writeSecretBase({ fingerprint: secrets.keyFingerprint, entries: secrets.agreed });
    secretBase = { fingerprint: secrets.keyFingerprint, entries: secrets.base };
    sealed = secrets.sealed;
    if (sealed) outcome.salt = sealed.salt;
  }
  const commit = () => {
    deps.writeBase(snapshotBase(merged));
    if (secretBase) deps.writeSecretBase(secretBase);
    outcome.committed = true;
  };
  const extra = remoteDocument?.extra;
  if (mode === "download") {
    outcome.contentHash = remoteDocument?.contentHash ?? null;
    outcome.version = remoteFile?.version ?? null;
    outcome.remoteHasSecrets = Boolean(remoteDocument?.secrets);
    commit();
    if (outcome.secretConflicts > 0) outcome.status = "conflict";
    return outcome;
  }
  const keepRemoteSecrets =
    !settings.includeSecrets && !settings.purgeRemoteSecrets && remoteDocument?.secrets;
  const secretsEnvelope =
    sealed?.envelope ?? (keepRemoteSecrets ? remoteDocument?.secrets : null) ?? null;
  const secretsFingerprint =
    sealed?.fingerprint ??
    (keepRemoteSecrets && remoteDocument?.secrets
      ? (remoteDocument.secretsFingerprint ?? hashText(remoteDocument.secrets))
      : null);
  const hash = await contentHash(merged, secretsFingerprint, extra);
  outcome.contentHash = hash;
  outcome.version = remoteFile?.version ?? null;
  const encrypt = settings.encryptAll;
  const modeSwitched = remoteDocument !== null && remoteEncrypted !== encrypt;
  const unchanged =
    mode === "sync" &&
    remoteDocument !== null &&
    remoteDocument.contentHash === hash &&
    !modeSwitched;
  if (!unchanged) {
    const document = toDocument(merged, {
      deviceId: memory.deviceId,
      updatedAt: now,
      contentHash: hash,
      secrets: secretsEnvelope,
      secretsFingerprint,
      extra,
    });
    let body = serializeDocument(document);
    if (encrypt) {
      const wrapped = await abortable(deps.transport.encrypt(body, outcome.salt), signal);
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
    const stored = await abortable(
      deps.transport.store(
        target.provider === "gist" && outcome.gistId
          ? { ...target, gistId: outcome.gistId }
          : target,
        body,
        remoteFile?.version ?? null,
        !remoteFile?.content,
        opId,
      ),
      signal,
    );
    if (stored.conflict) throw new SyncRemoteChangedError();
    outcome.uploaded = true;
    outcome.remoteEncrypted = encrypt;
    outcome.remoteHasSecrets = secretsEnvelope !== null;
    outcome.version = stored.version;
    outcome.warning = stored.warning;
    if (stored.gistId) outcome.gistId = stored.gistId;
  } else {
    outcome.remoteHasSecrets = Boolean(remoteDocument?.secrets);
    if (outcome.applied === null && outcome.secretsUpdated === 0) outcome.status = "skipped";
  }
  commit();
  if (outcome.secretConflicts > 0) outcome.status = "conflict";
  return outcome;
}
