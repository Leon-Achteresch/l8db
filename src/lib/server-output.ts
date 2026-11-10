import { toast } from "sonner";
import { create } from "zustand";

import { type DatabaseKind, type ServerMessage, setServerOutput, takeServerOutput } from "./db";

export interface ServerOutputEntry {
  id: string;
  connectionId: string;
  database: string | null;
  level: string;
  message: string;
  detail: string | null;
  at: number;
}

interface ServerOutputState {
  enabled: Record<string, boolean>;
  entries: Record<string, ServerOutputEntry[]>;
  setEnabled: (connectionId: string, enabled: boolean) => void;
  append: (connectionId: string, database: string | null, messages: ServerMessage[]) => void;
  clear: (connectionId: string) => void;
}

export const MAX_SERVER_OUTPUT_ENTRIES = 100_000;
const TOAST_REPEAT_MS = 60_000;
const toasted = new Map<string, Map<string, number>>();
const defaults = new Map<string, Promise<void>>();
let sequence = 0;

export const useServerOutputStore = create<ServerOutputState>()((set) => ({
  enabled: {},
  entries: {},
  setEnabled: (connectionId, enabled) =>
    set((state) => ({ enabled: { ...state.enabled, [connectionId]: enabled } })),
  append: (connectionId, database, messages) =>
    set((state) => {
      if (messages.length === 0) return state;
      const at = Date.now();
      const added = messages.map((message) => ({
        id: String(++sequence),
        connectionId,
        database,
        level: message.level || "NOTICE",
        message: message.message,
        detail: message.detail ?? null,
        at,
      }));
      const next = [...(state.entries[connectionId] ?? []), ...added];
      return {
        entries: {
          ...state.entries,
          [connectionId]: next.slice(Math.max(0, next.length - MAX_SERVER_OUTPUT_ENTRIES)),
        },
      };
    }),
  clear: (connectionId) => set((state) => ({ entries: { ...state.entries, [connectionId]: [] } })),
}));

export function isServerOutputEnabled(connectionId: string): boolean {
  return useServerOutputStore.getState().enabled[connectionId] === true;
}

export async function toggleServerOutput(
  kind: DatabaseKind,
  connectionString: string,
  connectionId: string,
  enabled: boolean,
  database?: string,
): Promise<void> {
  await setServerOutput(kind, connectionString, enabled, database);
  useServerOutputStore.getState().setEnabled(connectionId, enabled);
}

export function enableOracleOutput(
  kind: DatabaseKind,
  connectionString: string,
  connectionId: string,
  database?: string,
): Promise<void> {
  const store = useServerOutputStore.getState();
  if (kind !== "oracle" || store.enabled[connectionId] === false) return Promise.resolve();
  const key = `${connectionId}\n${connectionString}\n${database ?? ""}`;
  let ready = defaults.get(key);
  if (!ready) {
    if (!store.enabled[connectionId]) store.setEnabled(connectionId, true);
    ready = setServerOutput(kind, connectionString, true, database).catch(() => {
      defaults.delete(key);
    });
    defaults.set(key, ready);
  }
  return ready;
}

export async function collectServerOutput(
  kind: DatabaseKind,
  connectionString: string,
  connectionId: string,
  database?: string,
): Promise<number> {
  return deliverServerOutput(
    connectionId,
    database ?? null,
    await takeServerOutput(kind, connectionString, database),
  );
}

export function deliverServerOutput(
  connectionId: string,
  database: string | null,
  messages: ServerMessage[],
): number {
  const enabled = isServerOutputEnabled(connectionId);
  const warnings = messages.filter((message) => message.level === "WARNING");
  useServerOutputStore.getState().append(connectionId, database, enabled ? messages : warnings);
  const added = enabled ? messages.length : 0;
  if (!warnings.length) return added;
  const now = Date.now();
  const seen = toasted.get(connectionId) ?? new Map<string, number>();
  toasted.set(connectionId, seen);
  for (const [text, at] of seen) if (now - at > TOAST_REPEAT_MS) seen.delete(text);
  const fresh = warnings.filter((message) => !seen.has(message.message));
  if (!fresh.length) return added;
  for (const message of fresh) seen.set(message.message, now);
  const [title, ...lines] = fresh[0].message.split("\n");
  const extra = [...lines, ...fresh.slice(1).map((message) => message.message.split("\n")[0])];
  const more = extra.length > 3 ? [`… ${extra.length - 3} weitere in der Server-Ausgabe`] : [];
  toast.warning(title, { description: [...extra.slice(0, 3), ...more].join("\n") || undefined });
  return added;
}
