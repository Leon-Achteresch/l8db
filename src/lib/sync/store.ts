import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SyncProvider, SyncSecretBase, SyncTarget } from "@/lib/db/sync";
import { syncAcrossWindows } from "@/lib/window-sync";
import type { SyncBase } from "./payload";

export const SYNC_STORE_KEY = "l8db.sync";
export const SYNC_BASE_KEY = "l8db.sync-base";
export const SYNC_SECRET_BASE_KEY = "l8db.sync-secret-base";
export const MIN_AUTO_SYNC_MINUTES = 15;

export type SyncStatus = "idle" | "running" | "ok" | "skipped" | "error" | "conflict";

export interface SyncConfig {
  provider: SyncProvider | null;
  webdavUrl: string;
  webdavUser: string;
  webdavPath: string;
  webdavAllowInsecure: boolean;
  gistId: string;
  includeHistory: boolean;
  includeSecrets: boolean;
  encryptAll: boolean;
  autoSync: boolean;
  intervalMinutes: number;
  syncOnStart: boolean;
}

export type SyncSecretKind = "webdav" | "github" | "passphrase";

export interface SyncState extends SyncConfig {
  deviceId: string;
  storedSecrets: Record<SyncSecretKind, boolean>;
  markSecret: (kind: SyncSecretKind, stored: boolean) => void;
  lastSyncAt: number | null;
  lastStatus: SyncStatus;
  lastMessage: string | null;
  lastError: string | null;
  lastVersion: string | null;
  lastContentHash: string | null;
  lastSalt: string | null;
  lastMode: string | null;
  configure: (patch: Partial<Omit<SyncConfig, TargetField>>) => void;
  commitTarget: (patch: Partial<Pick<SyncConfig, TargetField>>) => void;
  report: (
    patch: Partial<
      Pick<
        SyncState,
        | "lastSyncAt"
        | "lastStatus"
        | "lastMessage"
        | "lastError"
        | "lastVersion"
        | "lastContentHash"
        | "lastSalt"
        | "lastMode"
        | "gistId"
      >
    >,
  ) => void;
  resetRemote: () => void;
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  provider: null,
  webdavUrl: "",
  webdavUser: "",
  webdavPath: "/l8db/l8db-sync.json",
  webdavAllowInsecure: false,
  gistId: "",
  includeHistory: false,
  includeSecrets: false,
  encryptAll: false,
  autoSync: false,
  intervalMinutes: 30,
  syncOnStart: false,
};

export type TargetField = "provider" | "webdavUrl" | "webdavPath" | "gistId";

export function targetKey(config: Pick<SyncConfig, TargetField>): string {
  const url = config.webdavUrl.trim().replace(/\/+$/, "");
  const path = `/${config.webdavPath.trim().replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  if (config.provider === "webdav") return `webdav|${url}|${path}`;
  if (config.provider === "gist") return `gist|${config.gistId.trim()}`;
  return "off";
}

export function targetChangeNeedsConfirmation(
  state: Pick<SyncState, TargetField | "lastSyncAt">,
  patch: Partial<Pick<SyncConfig, TargetField>>,
): boolean {
  if (state.lastSyncAt === null) return false;
  return targetKey({ ...state, ...patch }) !== targetKey(state);
}

export function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_SYNC_CONFIG.intervalMinutes;
  return Math.min(24 * 60, Math.max(MIN_AUTO_SYNC_MINUTES, Math.round(minutes)));
}

export function syncTarget(config: SyncConfig): SyncTarget | null {
  if (config.provider === "webdav") {
    if (!config.webdavUrl.trim() || !config.webdavPath.trim()) return null;
    return {
      provider: "webdav",
      url: config.webdavUrl.trim(),
      username: config.webdavUser.trim(),
      path: config.webdavPath.trim(),
      allowInsecure: config.webdavAllowInsecure,
    };
  }
  if (config.provider === "gist") return { provider: "gist", gistId: config.gistId.trim() || null };
  return null;
}

const REMOTE_RESET = {
  lastVersion: null,
  lastContentHash: null,
  lastSalt: null,
  lastMode: null,
};

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      ...DEFAULT_SYNC_CONFIG,
      deviceId: createDeviceId(),
      storedSecrets: { webdav: false, github: false, passphrase: false },
      markSecret: (kind, stored) =>
        set((state) => ({ storedSecrets: { ...state.storedSecrets, [kind]: stored } })),
      lastSyncAt: null,
      lastStatus: "idle",
      lastMessage: null,
      lastError: null,
      lastVersion: null,
      lastContentHash: null,
      lastSalt: null,
      lastMode: null,
      configure: (patch) =>
        set((state) => {
          const next = { ...patch };
          if (next.intervalMinutes !== undefined)
            next.intervalMinutes = clampInterval(next.intervalMinutes);
          if (next.encryptAll && !(next.includeSecrets ?? state.includeSecrets))
            next.encryptAll = false;
          if (next.includeSecrets === false) next.encryptAll = false;
          return next;
        }),
      commitTarget: (patch) =>
        set((state) => {
          const changed = targetKey({ ...state, ...patch }) !== targetKey(state);
          if (changed) clearSyncBase();
          return changed ? { ...patch, ...REMOTE_RESET } : patch;
        }),
      report: (patch) => set(patch),
      resetRemote: () => {
        clearSyncBase();
        set(REMOTE_RESET);
      },
    }),
    {
      name: SYNC_STORE_KEY,
      partialize: (state) => ({
        provider: state.provider,
        webdavUrl: state.webdavUrl,
        webdavUser: state.webdavUser,
        webdavPath: state.webdavPath,
        webdavAllowInsecure: state.webdavAllowInsecure,
        gistId: state.gistId,
        includeHistory: state.includeHistory,
        includeSecrets: state.includeSecrets,
        encryptAll: state.encryptAll,
        autoSync: state.autoSync,
        intervalMinutes: state.intervalMinutes,
        syncOnStart: state.syncOnStart,
        deviceId: state.deviceId,
        storedSecrets: state.storedSecrets,
        lastSyncAt: state.lastSyncAt,
        lastStatus: state.lastStatus === "running" ? "idle" : state.lastStatus,
        lastMessage: state.lastMessage,
        lastError: state.lastError,
        lastVersion: state.lastVersion,
        lastContentHash: state.lastContentHash,
        lastSalt: state.lastSalt,
        lastMode: state.lastMode,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SyncState>;
        return {
          ...current,
          ...saved,
          intervalMinutes: clampInterval(saved.intervalMinutes ?? current.intervalMinutes),
          deviceId: typeof saved.deviceId === "string" ? saved.deviceId : current.deviceId,
        };
      },
    },
  ),
);

syncAcrossWindows(SYNC_STORE_KEY, () => void useSyncStore.persist.rehydrate());

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSyncBase(): SyncBase {
  const raw = storage()?.getItem(SYNC_BASE_KEY);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as { v?: number; entries?: Record<string, [string, number]> };
    if (parsed.v !== 1 || !parsed.entries) return new Map();
    return new Map(
      Object.entries(parsed.entries).filter(
        ([, value]) =>
          Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

export function writeSyncBase(base: SyncBase): void {
  storage()?.setItem(SYNC_BASE_KEY, JSON.stringify({ v: 1, entries: Object.fromEntries(base) }));
}

export function clearSyncBase(): void {
  storage()?.removeItem(SYNC_BASE_KEY);
  storage()?.removeItem(SYNC_SECRET_BASE_KEY);
}

export function readSecretBase(): SyncSecretBase {
  try {
    const parsed = JSON.parse(storage()?.getItem(SYNC_SECRET_BASE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) =>
          Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number",
      ),
    ) as SyncSecretBase;
  } catch {
    return {};
  }
}

export function writeSecretBase(base: SyncSecretBase): void {
  storage()?.setItem(SYNC_SECRET_BASE_KEY, JSON.stringify(base));
}
