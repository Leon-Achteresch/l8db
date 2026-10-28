import { create } from "zustand";
import { connectionSummary } from "@/lib/connection-url";
import { USER_REQUIRED } from "@/lib/connection-url/constants";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { extractUrlPassword, injectUrlPassword, replaceUrlUser, storeSecret } from "@/lib/secrets";

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
  if (needsUser(connection)) return true;
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
  const hadPassword = extractUrlPassword(connection.connectionString) !== null;
  const answer = await requestPassword(connection, retryMessage ?? null);
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
