import { create } from "zustand";
import { connectionSummary } from "@/lib/connection-url";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { extractUrlPassword, injectUrlPassword, storeSecret } from "@/lib/secrets";

export interface PasswordAnswer {
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

export function needsPassword(connection: SavedConnection): boolean {
  if (extractUrlPassword(connection.connectionString) !== null) return false;
  try {
    return Boolean(connectionSummary(connection.connectionString, connection.kind).user);
  } catch {
    return false;
  }
}

export function requestPassword(
  connection: SavedConnection,
  message: string | null = null,
): Promise<PasswordAnswer | null> {
  return new Promise((resolve) => {
    usePasswordPrompt.setState({
      connection,
      message,
      resolve: (answer) => {
        usePasswordPrompt.setState({ connection: null, message: null, resolve: null });
        resolve(answer);
      },
    });
  });
}

export async function ensurePassword(id: string, retryMessage?: string): Promise<boolean> {
  const connection = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!connection) return true;
  if (!retryMessage && !needsPassword(connection)) return true;
  const answer = await requestPassword(connection, retryMessage ?? null);
  if (!answer) return false;
  if (!answer.password) return !retryMessage;
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((entry) =>
      entry.id === id
        ? { ...entry, connectionString: injectUrlPassword(entry.connectionString, answer.password) }
        : entry,
    ),
  }));
  if (answer.save) await storeSecret(id, answer.password).catch(() => undefined);
  return true;
}
