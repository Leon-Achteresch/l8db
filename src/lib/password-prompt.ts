import { create } from "zustand";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { extractUrlPassword, injectUrlPassword, storeSecret } from "@/lib/secrets";

export interface PasswordAnswer {
  password: string;
  save: boolean;
}

interface PasswordPromptState {
  connection: SavedConnection | null;
  resolve: ((answer: PasswordAnswer | null) => void) | null;
}

export const usePasswordPrompt = create<PasswordPromptState>(() => ({
  connection: null,
  resolve: null,
}));

export function needsPassword(connection: SavedConnection): boolean {
  if (!connection.connectionString.includes("://")) return false;
  try {
    const url = new URL(connection.connectionString);
    return Boolean(url.username) && extractUrlPassword(connection.connectionString) === null;
  } catch {
    return false;
  }
}

export function requestPassword(connection: SavedConnection): Promise<PasswordAnswer | null> {
  return new Promise((resolve) => {
    usePasswordPrompt.setState({
      connection,
      resolve: (answer) => {
        usePasswordPrompt.setState({ connection: null, resolve: null });
        resolve(answer);
      },
    });
  });
}

export async function ensurePassword(id: string): Promise<boolean> {
  const connection = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!connection || !needsPassword(connection)) return true;
  const answer = await requestPassword(connection);
  if (!answer) return false;
  if (!answer.password) return true;
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
