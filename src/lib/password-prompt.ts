import { create } from "zustand";
import { connectionSummary } from "@/lib/connection-url";
import { USER_REQUIRED } from "@/lib/connection-url/constants";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import {
  extractUrlPassword,
  injectUrlPassword,
  loadSecret,
  replaceUrlUser,
  storeSecret,
} from "@/lib/secrets";

export interface PasswordAnswer {
  user?: string;
  password: string;
  save: boolean;
}

interface PasswordPromptState {
  connection: SavedConnection | null;
  message: string | null;
  resolve: ((answer: PasswordAnswer | null) => void) | null;
}

export const usePasswordPrompt = create<PasswordPromptState>(() => ({
  connection: null,
  message: null,
  resolve: null,
}));

export function asksTeamUser(connection: SavedConnection): boolean {
  return (
    Boolean(connection.team) &&
    USER_REQUIRED.includes(connection.kind) &&
    connection.connectionString.includes("://")
  );
}

export function needsUser(connection: SavedConnection): boolean {
  if (!asksTeamUser(connection)) return false;
  try {
    return !connectionSummary(connection.connectionString, connection.kind).user;
  } catch {
    return false;
  }
}

export function needsPassword(connection: SavedConnection): boolean {
  if (connection.kind === "jdbc" || connection.kind === "workspace") return false;
  if (needsUser(connection)) return true;
  if (extractUrlPassword(connection.connectionString) !== null) return false;
  try {
    return Boolean(connectionSummary(connection.connectionString, connection.kind).user);
  } catch {
    return false;
  }
}

interface PasswordRequest {
  connection: SavedConnection;
  message: string | null;
  resolve: (answer: PasswordAnswer | null) => void;
}

const queue: PasswordRequest[] = [];

function showNext() {
  usePasswordPrompt.setState(queue[0] ?? { connection: null, message: null, resolve: null });
}

export function requestPassword(
  connection: SavedConnection,
  message: string | null = null,
  signal?: AbortSignal,
): Promise<PasswordAnswer | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => request.resolve(null);
    const request: PasswordRequest = {
      connection,
      message,
      resolve: (answer) => {
        const index = queue.indexOf(request);
        if (index < 0) return;
        queue.splice(index, 1);
        signal?.removeEventListener("abort", onAbort);
        if (index === 0) showNext();
        resolve(answer);
      },
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    queue.push(request);
    if (queue.length === 1) showNext();
  });
}

export async function ensurePassword(
  id: string,
  retryMessage?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  let connection = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!connection) return true;
  if (!retryMessage && !needsPassword(connection)) return true;
  if (!retryMessage && !needsUser(connection)) {
    const saved = await new Promise<string | null>((resolve) => {
      const onAbort = () => resolve(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      void loadSecret(id)
        .catch(() => null)
        .then((secret) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(secret);
        });
    });
    if (signal?.aborted) return false;
    const current = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
    if (!current) return false;
    if (!needsPassword(current)) return true;
    if (
      current.kind !== connection.kind ||
      current.connectionString !== connection.connectionString
    )
      return false;
    if (saved) {
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((entry) =>
          entry === current
            ? { ...entry, connectionString: injectUrlPassword(entry.connectionString, saved) }
            : entry,
        ),
      }));
      return true;
    }
    connection = current;
  }
  const hadPassword = extractUrlPassword(connection.connectionString) !== null;
  const answer = await requestPassword(connection, retryMessage ?? null, signal);
  if (!answer) return false;
  const user = answer.user?.trim() ?? "";
  if (user)
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === id
          ? { ...entry, connectionString: replaceUrlUser(entry.connectionString, user) }
          : entry,
      ),
    }));
  if (!answer.password) return !retryMessage;
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((entry) =>
      entry.id === id
        ? { ...entry, connectionString: injectUrlPassword(entry.connectionString, answer.password) }
        : entry,
    ),
  }));
  if (answer.save || (retryMessage && hadPassword)) {
    await storeSecret(id, answer.password).catch(() => undefined);
  }
  return true;
}
