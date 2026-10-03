import { create } from "zustand";
import { sanitizeAiRich } from "@/lib/ai/rich";
import type { AiMessage, AiProfile, AiProvider, AiServer } from "@/lib/db/ai";
import { syncAcrossWindows } from "@/lib/window-sync";

export const AI_PROVIDERS: { id: AiProvider; name: string; binary: string; cli: boolean }[] = [
  { id: "codex", name: "Codex", binary: "codex", cli: true },
  { id: "claude", name: "Claude Code", binary: "claude", cli: true },
  { id: "gemini-cli", name: "Gemini CLI", binary: "gemini", cli: true },
  { id: "opencode", name: "OpenCode", binary: "opencode", cli: true },
  { id: "copilot", name: "GitHub Copilot", binary: "copilot", cli: true },
  { id: "openai", name: "OpenAI · API", binary: "", cli: false },
  { id: "anthropic", name: "Anthropic · API", binary: "", cli: false },
  { id: "google", name: "Google · API", binary: "", cli: false },
  { id: "compatible", name: "OpenAI-compatible · API", binary: "", cli: false },
  { id: "ollama", name: "Ollama · Lokal", binary: "", cli: false },
  { id: "lmstudio", name: "LM Studio · Lokal", binary: "", cli: false },
];
export const AI_LOCAL_ENDPOINTS: Partial<Record<AiProvider, string>> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
};
export interface AiSession {
  id: string;
  title: string;
  profileId: string;
  nativeId: string | null;
  cwd: string;
  messages: AiMessage[];
  leafId?: string;
  nativeLeafId?: string;
  connectionIds: string[];
  connectionId?: string | null;
  updatedAt: number;
  deleted?: boolean;
  failed?: boolean;
  usage?: Record<string, unknown>;
  usageModel?: string;
  usageRequestedModel?: string;
}
export function aiSessionConnection(session: AiSession): string | null {
  return session.connectionId !== undefined
    ? session.connectionId
    : (session.connectionIds[0] ?? null);
}
export interface StoredProfile extends AiProfile {
  updatedAt: number;
}
export interface StoredServer extends AiServer {
  updatedAt: number;
  deleted?: boolean;
}
interface AiData {
  profiles: StoredProfile[];
  sessions: AiSession[];
  servers: StoredServer[];
}
interface AiState extends AiData {
  persistenceError: string;
  open: boolean;
  width: number;
  setWidth: (width: number) => void;
  profileId: string;
  sessionId: string | null;
  setOpen: (open: boolean) => void;
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
  pendingPrompt: string;
  ask: (prompt: string) => void;
  selectProfile: (id: string) => void;
  selectSession: (id: string | null) => void;
  saveProfile: (profile: AiProfile) => void;
  saveSession: (session: AiSession) => void;
  saveServer: (server: AiServer, deleted?: boolean) => void;
}
const KEY = "l8db.ai";
const WIDTH_KEY = "l8db.ai.panel-width";
const PROFILE_KEY = "l8db.ai.profile";
function readProfile(): string {
  try {
    const value = localStorage.getItem(PROFILE_KEY);
    return value && AI_PROVIDERS.some((provider) => provider.id === value) ? value : "codex";
  } catch {
    return "codex";
  }
}
function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= 320 ? Math.min(760, value) : 420;
  } catch {
    return 420;
  }
}
export function mergeAiRecords<T extends { id: string; updatedAt: number }>(
  local: T[],
  incoming: T[],
): T[] {
  const entries = new Map(local.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    if (entry.updatedAt > (entries.get(entry.id)?.updatedAt ?? -1)) entries.set(entry.id, entry);
  }
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function sanitizeSession(session: AiSession): AiSession {
  return {
    ...session,
    messages: session.messages.map(
      (
        {
          id,
          parentId,
          role,
          text,
          rich,
          reasoning,
          error,
          stopped,
          createdAt,
          durationMs,
          attachments,
        },
        index,
      ) => ({
        id: id ?? `m${index}`,
        ...(parentId !== undefined ? { parentId } : {}),
        role,
        text,
        ...(rich ? { rich: sanitizeAiRich(rich) } : {}),
        ...(typeof reasoning === "string" && reasoning ? { reasoning } : {}),
        ...(typeof error === "string" && error ? { error } : {}),
        ...(stopped ? { stopped: true } : {}),
        ...(typeof createdAt === "number" ? { createdAt } : {}),
        ...(typeof durationMs === "number" ? { durationMs } : {}),
        ...(Array.isArray(attachments) && attachments.length
          ? { attachments: attachments.slice(0, 10) }
          : {}),
      }),
    ),
  };
}
function readData(value: string | null): AiData {
  try {
    const data = JSON.parse(value ?? "{}");
    return {
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      sessions: Array.isArray(data.sessions)
        ? data.sessions.map((session: AiSession) => sanitizeSession(session))
        : [],
      servers: Array.isArray(data.servers) ? data.servers : [],
    };
  } catch {
    return { profiles: [], sessions: [], servers: [] };
  }
}
function readStorage(): AiData {
  try {
    return readData(localStorage.getItem(KEY));
  } catch {
    return readData(null);
  }
}
const defaults: StoredProfile[] = AI_PROVIDERS.map((provider) => ({
  id: provider.id,
  provider: provider.id,
  binary: provider.binary,
  home: "",
  endpoint: AI_LOCAL_ENDPOINTS[provider.id] ?? "",
  model: "",
  effort: "",
  mode: "",
  updatedAt: 0,
}));
const initial = readStorage();
export const useAiStore = create<AiState>((set) => ({
  ...initial,
  persistenceError: "",
  profiles: mergeAiRecords(defaults, initial.profiles),
  open: false,
  width: readWidth(),
  setWidth: (width) => {
    const value = Math.min(760, Math.max(320, width));
    set({ width: value });
    try {
      localStorage.setItem(WIDTH_KEY, String(value));
    } catch {
      return;
    }
  },
  profileId: readProfile(),
  sessionId: null,
  setOpen: (open) => set({ open, minimized: false }),
  minimized: false,
  setMinimized: (minimized) => set({ minimized }),
  pendingPrompt: "",
  ask: (pendingPrompt) => set({ pendingPrompt, open: true, minimized: false }),
  selectProfile: (profileId) => {
    set({ profileId, sessionId: null });
    try {
      localStorage.setItem(PROFILE_KEY, profileId);
    } catch {
      return;
    }
  },
  selectSession: (sessionId) => set({ sessionId }),
  saveProfile: (profile) =>
    set((state) => ({
      profiles: mergeAiRecords(state.profiles, [
        {
          ...profile,
          updatedAt: Math.max(Date.now(), ...state.profiles.map((entry) => entry.updatedAt + 1)),
        },
      ]),
    })),
  saveSession: (session) =>
    set((state) => ({
      sessions: mergeAiRecords(state.sessions, [
        {
          ...sanitizeSession(session),
          updatedAt: Math.max(
            session.updatedAt,
            Date.now(),
            (state.sessions.find((entry) => entry.id === session.id)?.updatedAt ?? 0) + 1,
          ),
        },
      ]),
    })),
  saveServer: (server, deleted) =>
    set((state) => ({
      servers: mergeAiRecords(state.servers, [
        {
          ...server,
          deleted,
          updatedAt: Math.max(Date.now(), ...state.servers.map((entry) => entry.updatedAt + 1)),
        },
      ]),
    })),
}));
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistData() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  try {
    const state = useAiStore.getState();
    const other = readStorage();
    const data = {
      profiles: mergeAiRecords(state.profiles, other.profiles),
      sessions: mergeAiRecords(state.sessions, other.sessions),
      servers: mergeAiRecords(state.servers, other.servers),
    };
    const value = JSON.stringify(data);
    if (localStorage.getItem(KEY) !== value) localStorage.setItem(KEY, value);
    if (state.persistenceError) useAiStore.setState({ persistenceError: "" });
  } catch {
    useAiStore.setState({
      persistenceError:
        "AI-Daten konnten nicht lokal gespeichert werden. Lösche bei vollem Speicher ein altes Gespräch.",
    });
  }
}
useAiStore.subscribe((state, previous) => {
  if (
    state.profiles === previous.profiles &&
    state.sessions === previous.sessions &&
    state.servers === previous.servers
  )
    return;
  if (!persistTimer) persistTimer = setTimeout(persistData, 150);
});
if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  window.addEventListener("pagehide", persistData);
syncAcrossWindows(KEY, (value) => {
  const incoming = readData(value);
  useAiStore.setState((state) => ({
    profiles: mergeAiRecords(state.profiles, incoming.profiles),
    sessions: mergeAiRecords(state.sessions, incoming.sessions),
    servers: mergeAiRecords(state.servers, incoming.servers),
  }));
});

syncAcrossWindows(WIDTH_KEY, () => useAiStore.setState({ width: readWidth() }));
