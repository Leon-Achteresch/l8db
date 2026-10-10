import type { SyncSealed, SyncTarget } from "../../src/lib/db/sync";
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
        return { version: null, gistId: null, conflict: true };
      this.content = content;
      this.version++;
      this.bytesWritten += content.length;
      return { version: `"v${this.version}"`, gistId: null, conflict: false };
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
  begin(label: string) {
    if (this.active && this.active !== label) return false;
    this.active = label;
    return true;
  }
  end(label: string) {
    if (this.active === label) this.active = null;
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
      throw new Error("Entschlüsselung fehlgeschlagen: Passphrase falsch oder Daten manipuliert.");
    return Buffer.from(parsed.data, "base64").toString();
  };
  return { seal, open };
}

export interface Device {
  label: string;
  collections: LocalCollections;
  base: SyncBase;
  secrets: Map<string, string>;
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
      end: async () => coordinator.end(label),
      fetch: (_target, opId) => remote.fetch(opId),
      store: (_target, content, ifMatch, expectAbsent, opId) =>
        remote.store(content, ifMatch, expectAbsent, opId),
      cancel: (opId) => remote.cancel(opId),
      encrypt: async (plaintext, salt) => crypto.seal(plaintext, salt),
      decrypt: async (envelope) => crypto.open(envelope),
      sealSecrets: async (accounts, salt) => {
        const found = Object.fromEntries(
          accounts.filter((a) => state.secrets.has(a)).map((a) => [a, state.secrets.get(a)]),
        );
        return Object.keys(found).length ? crypto.seal(JSON.stringify(found), salt) : null;
      },
      openSecrets: async (envelope, accounts) => {
        const found = JSON.parse(crypto.open(envelope)) as Record<string, string>;
        const updated: string[] = [];
        for (const account of accounts) {
          if (found[account] !== undefined && state.secrets.get(account) !== found[account]) {
            state.secrets.set(account, found[account]);
            updated.push(account);
          }
        }
        return updated;
      },
      backup: async (content, reason) => {
        state.backups.push(content);
        return {
          id: `${state.backups.length}-${reason}`,
          createdAt: 0,
          reason,
          size: content.length,
        };
      },
    },
    local,
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
