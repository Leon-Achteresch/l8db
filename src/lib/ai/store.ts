import { create } from "zustand";
import type { ChatContextItem } from "@/lib/ai/chat-context";
import { sanitizeAiRich } from "@/lib/ai/rich-core";
import { readAiSessions, writeAiSessions } from "@/lib/ai/session-db";
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
  summary?: { upTo: string; count: number; text: string };
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
  ask: (prompt: string, context?: ChatContextItem[]) => void;
  pendingDraft: string;
  draft: (text: string) => void;
  pendingContext: ChatContextItem[];
  attach: (item: ChatContextItem) => void;
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
          context,
          contextLabels,
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
        ...(typeof context === "string" && context ? { context } : {}),
        ...(Array.isArray(contextLabels) && contextLabels.length
          ? {
              contextLabels: contextLabels
                .filter((label) => typeof label === "string")
                .slice(0, 20),
            }
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
  ask: (pendingPrompt, pendingContext = []) =>
    set({ pendingPrompt, pendingContext, open: true, minimized: false }),
  pendingDraft: "",
  draft: (text) =>
    set((state) => ({
      pendingDraft: state.pendingDraft ? `${state.pendingDraft}\n\n${text}` : text,
      open: true,
      minimized: false,
    })),
  pendingContext: [],
  attach: (item) =>
    set((state) => ({
      pendingContext: [...state.pendingContext.filter((entry) => entry.id !== item.id), item],
      open: true,
      minimized: false,
    })),
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
const SESSIONS_KEY = "l8db.ai.sessions";
const PENDING_KEY = "l8db.ai.pending";
const STORAGE_ERROR =
  "AI-Daten konnten nicht lokal gespeichert werden. Lösche bei vollem Speicher ein altes Gespräch.";
const dirty = new Set<string>();
const writing = new Set<string>();
let legacySessions = initial.sessions.length > 0;
let applyingRemote = false;
let localFailed = false;
let sessionsFailed = false;
let loadFailed = false;
let flushing: Promise<void> = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function report() {
  const persistenceError = localFailed || sessionsFailed || loadFailed ? STORAGE_ERROR : "";
  if (useAiStore.getState().persistenceError !== persistenceError)
    useAiStore.setState({ persistenceError });
}
function applySessions(incoming: AiSession[]) {
  const sessions = incoming.flatMap((session) => {
    try {
      return [sanitizeSession(session)];
    } catch {
      return [];
    }
  });
  if (!sessions.length) return;
  applyingRemote = true;
  try {
    useAiStore.setState((state) => ({ sessions: mergeAiRecords(state.sessions, sessions) }));
  } finally {
    applyingRemote = false;
  }
}
function readPending(): AiSession[] {
  try {
    return readData(localStorage.getItem(PENDING_KEY)).sessions;
  } catch {
    return [];
  }
}
async function loadSessions() {
  const pending = readPending();
  if (legacySessions || pending.length) {
    const failed = await writeAiSessions([...initial.sessions, ...pending]);
    if (failed.length) throw new Error("AI-Verlauf konnte nicht übernommen werden");
    localStorage.removeItem(PENDING_KEY);
    legacySessions = false;
    persistData();
  }
  applySessions(await readAiSessions());
  loadFailed = false;
}
function flushSessions(): Promise<void> {
  flushing = flushing.then(async () => {
    if (loadFailed) await loadSessions().catch(() => undefined);
    if (dirty.size) {
      for (const id of dirty) writing.add(id);
      dirty.clear();
      let failed: string[];
      try {
        failed = await writeAiSessions(
          useAiStore.getState().sessions.filter((entry) => writing.has(entry.id)),
        );
      } catch {
        failed = [...writing];
      }
      for (const id of failed) dirty.add(id);
      const saved = [...writing].filter((id) => !dirty.has(id));
      writing.clear();
      sessionsFailed = failed.length > 0;
      if (saved.length) notifyWindows(saved);
    }
    report();
  });
  return flushing;
}
function notifyWindows(ids: string[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify({ ids, at: Math.random() }));
  } catch {
    return;
  }
}
function persistOnHide() {
  const ids = new Set([...dirty, ...writing]);
  persistData();
  if (!ids.size) return;
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        sessions: useAiStore.getState().sessions.filter((entry) => ids.has(entry.id)),
      }),
    );
  } catch {
    return;
  }
}
function persistData() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  void flushSessions();
  try {
    const state = useAiStore.getState();
    const other = readStorage();
    const value = JSON.stringify({
      profiles: mergeAiRecords(state.profiles, other.profiles),
      servers: mergeAiRecords(state.servers, other.servers),
      ...(legacySessions ? { sessions: other.sessions } : {}),
    });
    if (localStorage.getItem(KEY) !== value) localStorage.setItem(KEY, value);
    localFailed = false;
  } catch {
    localFailed = true;
  }
  report();
}
useAiStore.subscribe((state, previous) => {
  if (state.sessions !== previous.sessions && !applyingRemote) {
    const before = new Map(previous.sessions.map((entry) => [entry.id, entry]));
    for (const entry of state.sessions) if (before.get(entry.id) !== entry) dirty.add(entry.id);
  }
  if (state.profiles === previous.profiles && state.servers === previous.servers && !dirty.size)
    return;
  if (!persistTimer) persistTimer = setTimeout(persistData, 150);
});
export const aiSessionsLoaded = loadSessions().catch(() => {
  loadFailed = true;
  report();
});
if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  window.addEventListener("pagehide", persistOnHide);
syncAcrossWindows(KEY, (value) => {
  const incoming = readData(value);
  useAiStore.setState((state) => ({
    profiles: mergeAiRecords(state.profiles, incoming.profiles),
    servers: mergeAiRecords(state.servers, incoming.servers),
  }));
  applySessions(incoming.sessions);
});
syncAcrossWindows(SESSIONS_KEY, (value) => {
  try {
    const ids: unknown = JSON.parse(value ?? "{}").ids;
    if (Array.isArray(ids))
      void readAiSessions(ids.filter((id) => typeof id === "string"))
        .then(applySessions)
        .catch(() => undefined);
  } catch {
    return;
  }
});

syncAcrossWindows(WIDTH_KEY, () => useAiStore.setState({ width: readWidth() }));
