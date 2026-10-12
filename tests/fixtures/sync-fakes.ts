import { SyncDecryptError, type SyncSealed, type SyncTarget } from "../../src/lib/db/sync";
import type { SyncDecider, SyncDeps, SyncLocal } from "../../src/lib/sync/engine";
import {
  hashText,
  type LocalCollections,
  type LocalItem,
  SYNC_COLLECTIONS,
  type SyncBase,
  type SyncCollection,
} from "../../src/lib/sync/payload";

export const webdav: SyncTarget = {
  provider: "webdav",
  url: "https://cloud.example/remote.php/dav/files/leon",
  username: "leon",
  path: "/l8db/l8db-sync.json",
  allowInsecure: false,
};

export function emptyCollections(): LocalCollections {
  return Object.fromEntries(
    SYNC_COLLECTIONS.map((collection) => [collection, [] as LocalItem[]]),
  ) as LocalCollections;
}

export class FakeRemote {
  content: string | null = null;
  version = 0;
  gets = 0;
  puts = 0;
  inFlight = 0;
  maxInFlight = 0;
  delayMs = 0;
  bytesWritten = 0;
  cancelled: string[] = [];
  pending = new Map<string, () => void>();

  private async hold<T>(opId: string, work: () => T): Promise<T> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs > 0)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, this.delayMs);
          this.pending.set(opId, () => {
            clearTimeout(timer);
            reject(new Error("Synchronisierung abgebrochen."));
          });
        });
      return work();
    } finally {
      this.pending.delete(opId);
      this.inFlight--;
    }
  }

  fetch(opId: string) {
    this.gets++;
    return this.hold(opId, () => ({
      content: this.content,
      version: this.content ? `"v${this.version}"` : null,
      gistId: null,
    }));
  }

  store(content: string, ifMatch: string | null, expectAbsent: boolean, opId: string) {
    this.puts++;
    return this.hold(opId, () => {
      const current = this.content ? `"v${this.version}"` : null;
      if ((ifMatch && ifMatch !== current) || (expectAbsent && current))
        return { version: null, gistId: null, conflict: true, warning: null };
      this.content = content;
      this.version++;
      this.bytesWritten += content.length;
      return { version: `"v${this.version}"`, gistId: null, conflict: false, warning: null };
    });
  }

  cancel(opId: string) {
    this.cancelled.push(opId);
    const abort = this.pending.get(opId);
    abort?.();
    return Promise.resolve(Boolean(abort));
  }
}

export class FakeCoordinator {
  active: string | null = null;
  token: string | null = null;
  private counter = 0;
  begin(label: string) {
    if (this.active) return null;
    this.active = label;
    this.token = `${label}-${++this.counter}`;
    return this.token;
  }
  end(token: string) {
    if (this.token !== token) return false;
    this.active = null;
    this.token = null;
    return true;
  }
}

export function fakeCrypto(passphrase: { value: string }) {
  const seal = (plaintext: string, salt: string | null): SyncSealed => {
    const usedSalt = salt ?? "c2FsdHNhbHRzYWx0c2FsdA==";
    return {
      envelope: JSON.stringify({
        v: 1,
        kdf: { alg: "argon2id", salt: usedSalt },
        key: hashText(passphrase.value),
        data: Buffer.from(plaintext).toString("base64"),
      }),
      fingerprint: hashText(`${passphrase.value}|${usedSalt}|${plaintext}`),
      salt: usedSalt,
    };
  };
  const open = (envelope: string) => {
    const parsed = JSON.parse(envelope) as { key: string; data: string };
    if (parsed.key !== hashText(passphrase.value))
      throw new SyncDecryptError(
        "auth",
        "Entschlüsselung fehlgeschlagen: Passphrase falsch oder Daten manipuliert.",
      );
    return Buffer.from(parsed.data, "base64").toString();
  };
  return { seal, open };
}

export interface Device {
  label: string;
  collections: LocalCollections;
  base: SyncBase;
  secrets: Map<string, string>;
  secretBase: { fingerprint: string | null; entries: Record<string, [string, number]> };
  secretEdits: Record<string, number>;
  keyFingerprint: string;
  secretBackups: Map<string, Record<string, string | null>>;
  secretMerges: number;
  backups: string[];
  applied: number;
  deps: SyncDeps;
}

export function device(
  label: string,
  remote: FakeRemote,
  coordinator: FakeCoordinator,
  options: { passphrase?: { value: string }; clock?: () => number } = {},
): Device {
  const passphrase = options.passphrase ?? { value: "korrekte passphrase" };
  const crypto = fakeCrypto(passphrase);
  const state: Device = {
    label,
    collections: emptyCollections(),
    base: new Map(),
    secrets: new Map(),
    secretBase: { fingerprint: null, entries: {} },
    secretEdits: {},
    keyFingerprint: `key-${label}`,
    secretBackups: new Map(),
    secretMerges: 0,
    backups: [],
    applied: 0,
    deps: undefined as unknown as SyncDeps,
  };
  const local: SyncLocal = {
    collect: (includeHistory) => ({
      ...state.collections,
      history: includeHistory ? state.collections.history : [],
    }),
    apply: (collections, include: ReadonlySet<SyncCollection>) => {
      state.applied++;
      for (const collection of include)
        state.collections[collection] = structuredClone(collections[collection]);
    },
    secretAccounts: (items) => items.flatMap((item) => [item.id, `${item.id}:ssh`]),
    forgetSecrets: () => undefined,
  };
  state.deps = {
    transport: {
      begin: async () => coordinator.begin(label),
      end: async (token) => coordinator.end(token),
      fetch: (_target, opId) => remote.fetch(opId),
      store: (_target, content, ifMatch, expectAbsent, opId) =>
        remote.store(content, ifMatch, expectAbsent, opId),
      cancel: (opId) => remote.cancel(opId),
      encrypt: async (plaintext, salt) => crypto.seal(plaintext, salt),
      decrypt: async (envelope) => crypto.open(envelope),
      mergeSecrets: async (request) => {
        state.secretMerges++;
        const remote: Record<string, { v: string | null; t: number }> = request.envelope
          ? JSON.parse(crypto.open(request.envelope))
          : {};
        const merged: Record<string, { v: string | null; t: number }> = {};
        const base: Record<string, [string, number]> = {};
        const agreed: Record<string, [string, number]> = {};
        const updated: string[] = [];
        const conflicts: string[] = [];
        const previous: [string, string | null][] = [];
        const values = request.accounts.map((account) => state.secrets.get(account) ?? null);
        const baseEntries = request.keyFingerprint === state.keyFingerprint ? request.base : {};
        const writes: [string, string | null][] = [];
        request.accounts.forEach((account, index) => {
          const value = values[index];
          const known = baseEntries[account];
          const ours = value !== null ? value : known ? "-" : null;
          const unchanged = known !== undefined && known[0] === ours;
          const editedAt = unchanged ? known[1] : request.editedAt[account];
          const oursAt = editedAt ?? request.now;
          const entry = request.mode === "upload" ? undefined : remote[account];
          const theirs = entry ? (entry.v ?? "-") : null;
          const bothChanged = ours !== theirs && ours !== known?.[0] && theirs !== known?.[0];
          const firstContact =
            ours !== null &&
            theirs !== null &&
            ours !== theirs &&
            (!known || (bothChanged && editedAt === undefined));
          let takeRemote: boolean;
          if (request.mode === "upload") takeRemote = false;
          else if (request.mode === "download") takeRemote = theirs !== null;
          else if (firstContact) {
            const resolution = request.resolutions?.[account];
            if (!resolution) {
              conflicts.push(account);
              if (entry) merged[account] = entry;
              return;
            }
            takeRemote = resolution === "remote";
          } else
            takeRemote =
              ours === theirs || theirs === null || theirs === known?.[0]
                ? false
                : ours === null || ours === known?.[0]
                  ? true
                  : (entry?.t ?? 0) > oursAt;
          const chosen =
            takeRemote && entry
              ? entry
              : {
                  v: value,
                  t:
                    ours === theirs && entry
                      ? entry.t
                      : firstContact && entry
                        ? Math.max(oursAt, entry.t + 1)
                        : oursAt,
                };
          const state_ = takeRemote ? theirs : ours;
          if (takeRemote && entry && entry.v !== value) {
            writes.push([account, entry.v]);
            previous.push([account, value]);
          }
          if (state_ === null) return;
          if (theirs === state_) agreed[account] = [state_, chosen.t];
          else if (known) agreed[account] = known;
          merged[account] = chosen;
          base[account] = [state_, chosen.t];
        });
        let backup: string | null = null;
        if (previous.length > 0) {
          backup = request.backupId ?? `${request.now}-passwoerter`;
          const existing = state.secretBackups.get(backup) ?? {};
          for (const [account, value] of previous)
            if (!(account in existing)) existing[account] = value;
          state.secretBackups.set(backup, existing);
        }
        for (const [account, value] of writes) {
          if (value === null) state.secrets.delete(account);
          else state.secrets.set(account, value);
          updated.push(account);
        }
        const sealed =
          Object.keys(merged).length && request.mode !== "download"
            ? crypto.seal(JSON.stringify(merged), request.salt)
            : null;
        return {
          keyFingerprint: state.keyFingerprint,
          sealed,
          base,
          agreed,
          updated,
          conflicts,
          backup,
        };
      },
      backup: async (content, reason) => {
        state.backups.push(content);
        return {
          id: `${state.backups.length}-${reason}`,
          createdAt: 0,
          reason,
          size: content.length,
          hasData: true,
          hasSecrets: false,
        };
      },
    },
    local,
    readSecretBase: () => ({ ...state.secretBase, entries: { ...state.secretBase.entries } }),
    writeSecretBase: (base) => {
      state.secretBase = { ...base, entries: { ...base.entries } };
    },
    readSecretEdits: () => ({ ...state.secretEdits }),
    readBase: () => new Map(state.base),
    writeBase: (base) => {
      state.base = new Map(base);
    },
    now: options.clock ?? (() => Date.now()),
  };
  return state;
}

export const acceptAll: SyncDecider = {
  conflicts: async () => "both",
  preview: async () => true,
};

export function connection(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      id,
      name,
      kind: "postgres",
      connectionString: `postgres://app@db-${id}.example.com:5432/app`,
      sslMode: "prefer",
      ...extra,
    },
  };
}
