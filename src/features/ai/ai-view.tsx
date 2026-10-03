import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Database, History, Maximize2, Plus, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { aiConnections, mergeAiModels } from "@/lib/ai/context";
import { mergeAiRich, normalizeAiRich } from "@/lib/ai/rich";
import { AI_PROVIDERS, type AiSession, useAiStore } from "@/lib/ai/store";
import { mergeAiUsage } from "@/lib/ai/usage";
import { useConnectionsStore } from "@/lib/connections";
import {
  type AiEvent,
  type AiModels,
  type AiStatus,
  aiCancel,
  aiEnvironment,
  aiModels,
  aiRun,
  aiSkills,
  aiStatus,
} from "@/lib/db/ai";
import { useDbSelectionStore } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AiApprovalPicker } from "./ai-approval-picker";
import { AiCapabilities } from "./ai-capabilities";
import { AiContext } from "./ai-context";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiReasoningPicker } from "./ai-reasoning-picker";
import { AiSettings } from "./ai-settings";
import { AiTranscript } from "./ai-transcript";
import { AiUsage } from "./ai-usage";
import { AISidebar } from "./beui/agents/ai-sidebar";
import { ChatApp } from "./beui/agents/chat-app";
import { AgentProgress } from "./beui/agents/loading-states";
import { PromptInput } from "./beui/agents/prompt-input";

export function AiView({ fullPage = false }: { fullPage?: boolean }) {
  const navigate = useNavigate();
  const state = useAiStore();
  const profile = state.profiles.find((entry) => entry.id === state.profileId) ?? state.profiles[0];
  const session = state.sessions.find((entry) => entry.id === state.sessionId && !entry.deleted);
  const connections = useConnectionsStore((value) => value.connections);
  const activeId = useConnectionsStore((value) => value.activeId);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState<"chat" | "settings" | "history" | "context">("chat");
  const [contextOpen, setContextOpen] = useState(false);
  const [models, setModels] = useState<AiModels>({ models: [] });
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [skills, setSkills] = useState<{ name: string; path: string }[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [allowWrites, setAllowWrites] = useState(false);
  const [allowDdl, setAllowDdl] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [approvals, setApprovals] = useState<AiEvent[]>([]);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [usage, setUsage] = useState<Record<string, unknown>>({});
  const [runStatus, setRunStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const discovery = useRef(0);
  const discoveryProfile = useMemo(
    () => ({
      id: profile.id,
      provider: profile.provider,
      binary: profile.binary,
      home: profile.home,
      endpoint: profile.endpoint,
      model: "",
      effort: "",
      mode: "",
      revision,
    }),
    [profile.id, profile.provider, profile.binary, profile.home, profile.endpoint, revision],
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const run = useRef<string | null>(null);
  const afterTool = useRef(false);
  const approvalTitles = useRef(new Map<string, string>());
  const liveSession = useRef<AiSession | null>(null);
  const usageRef = useRef<Record<string, unknown>>({});
  const features = useNewFeatureVisibility<HTMLElement>("ai.chat");
  const historyFeature = useNewFeatureVisibility<HTMLDivElement>(
    view === "history" ? "ai.history" : undefined,
  );
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider) ?? AI_PROVIDERS[0];
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    void aiEnvironment()
      .then((environment) => setCwd(environment.cwd))
      .catch((error) => setError(String(error)));
  }, []);
  useEffect(() => {
    if (run.current) return;
    if ((!state.open && !fullPage) || !cwd.trim()) {
      setLoading(false);
      return;
    }
    const token = ++discovery.current;
    setLoading(true);
    setError("");
    setStatus(null);
    setModels({ models: [] });
    const timer = setTimeout(() => {
      void Promise.allSettled([
        aiStatus(discoveryProfile),
        aiModels(discoveryProfile, cwd),
        aiSkills(cwd, discoveryProfile),
      ]).then((results) => {
        if (token !== discovery.current) return;
        const [statusResult, modelsResult, skillsResult] = results;
        if (statusResult.status === "fulfilled") setStatus(statusResult.value);
        else setError(String(statusResult.reason));
        if (modelsResult.status === "fulfilled") {
          setModels(mergeAiModels({ models: [] }, { ...modelsResult.value }));
          setMetadata({ ...modelsResult.value });
        } else setError(String(modelsResult.reason));
        if (skillsResult.status === "fulfilled") setSkills(skillsResult.value);
        else setSkills([]);
        setLoading(false);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      discovery.current++;
    };
  }, [discoveryProfile, cwd, state.open, fullPage]);
  useEffect(() => {
    if ((state.open || fullPage) && view === "chat") input.current?.focus();
  }, [state.open, view, fullPage]);
  const resetContext = () => {
    setSelectedSkills([]);
    setSelectedServers([]);
    setMentioned([]);
    setReasoning("");
    setEvents([]);
    setApprovals([]);
    setUsage({});
    setAllowWrites(false);
    setAllowDdl(false);
  };
  const resolve = (id: string) =>
    setApprovals((entries) => entries.filter((entry) => String(entry.data.id) !== id));
  const saveLive = () => {
    if (liveSession.current) {
      liveSession.current = {
        ...liveSession.current,
        updatedAt: Math.max(Date.now(), liveSession.current.updatedAt + 1),
      };
      useAiStore.getState().saveSession(liveSession.current);
    }
  };
  const send = async (text = prompt) => {
    if (!text.trim() || run.current) return;
    setError("");
    try {
      const current = useConnectionsStore.getState();
      const selected = aiConnections(
        current.connections,
        current.activeId,
        mentioned,
        useDbSelectionStore.getState().databaseByConnection,
      );
      const id = crypto.randomUUID();
      const next: AiSession = {
        ...(session ?? {
          id: crypto.randomUUID(),
          title: text.trim().slice(0, 70),
          profileId: profile.id,
          nativeId: null,
          cwd,
          messages: [],
          connectionIds: [],
          updatedAt: Date.now(),
        }),
        cwd,
        usageRequestedModel: profile.model,
        connectionIds: selected.map((connection) => connection.id),
        messages: [
          ...(session?.messages ?? []),
          { id: crypto.randomUUID(), role: "user", text: text.trim() },
          { id: crypto.randomUUID(), role: "assistant", text: "" },
        ],
        updatedAt: Date.now(),
      };
      liveSession.current = next;
      state.saveSession(next);
      state.selectSession(next.id);
      run.current = id;
      afterTool.current = false;
      setRunId(id);
      setPrompt("");
      setReasoning("");
      setEvents([]);
      setApprovals([]);
      setUsage({});
      usageRef.current = {};
      liveSession.current = { ...next, usage: {}, usageModel: profile.model };
      setRunStatus("Startet …");
      await aiRun(
        {
          runId: id,
          profile,
          cwd,
          sessionId: next.nativeId,
          messages: next.messages.slice(0, -1).map(({ role, text }) => ({ role, text })),
          connections: selected,
          activeId: current.activeId,
          skills: selectedSkills.filter((path) => skills.some((skill) => skill.path === path)),
          servers: state.servers.filter(
            (server) => !server.deleted && selectedServers.includes(server.id),
          ),
          allowWrites,
          allowDdl,
        },
        (event) => {
          if (run.current !== id) return;
          const blocks = normalizeAiRich(event);
          if (blocks.length && liveSession.current) {
            const messages = [...liveSession.current.messages];
            const last = messages[messages.length - 1];
            messages[messages.length - 1] = {
              ...last,
              rich: mergeAiRich(last.rich, blocks, last.text.length),
            };
            liveSession.current = { ...liveSession.current, messages };
            saveLive();
          }
          if (event.kind === "text" && liveSession.current) {
            const messages = [...liveSession.current.messages];
            const last = messages[messages.length - 1];
            messages[messages.length - 1] = {
              ...last,
              text:
                last.text +
                (afterTool.current && last.text && !last.text.endsWith("\n") ? "\n\n" : "") +
                String(event.data.delta ?? ""),
            };
            afterTool.current = false;
            liveSession.current = { ...liveSession.current, messages };
            saveLive();
          } else if (event.kind === "reasoning")
            setReasoning((value) => value + String(event.data.delta ?? ""));
          else if (event.kind === "tool") {
            afterTool.current = true;
            setEvents((entries) => {
              const index = entries.findIndex(
                (entry) => event.data.id && entry.data.id === event.data.id,
              );
              if (index < 0) return [...entries, event];
              return entries.map((entry, i) =>
                i === index
                  ? {
                      ...event,
                      data: {
                        ...entry.data,
                        ...Object.fromEntries(
                          Object.entries(event.data).filter(([, value]) => value != null),
                        ),
                      },
                    }
                  : entry,
              );
            });
          } else if (event.kind === "approval" || event.kind === "input") {
            approvalTitles.current.set(
              String(event.data.id),
              String(event.data.title ?? "Agent-Entscheidung"),
            );
            setApprovals((entries) => [
              ...entries.filter((entry) => entry.data.id !== event.data.id),
              event,
            ]);
          } else if (event.kind === "approvalResolved") {
            const approvalTitle = approvalTitles.current.get(String(event.data.id));
            if (liveSession.current) {
              const messages = [...liveSession.current.messages];
              const last = messages[messages.length - 1];
              messages[messages.length - 1] = {
                ...last,
                rich: mergeAiRich(
                  last.rich,
                  [
                    {
                      type: "decision",
                      id: String(event.data.id),
                      title: String(approvalTitle ?? "Agent-Entscheidung"),
                      outcome:
                        typeof event.data.allowed === "boolean"
                          ? event.data.allowed
                            ? "allowed"
                            : "denied"
                          : "answered",
                    },
                  ],
                  last.text.length,
                ),
              };
              liveSession.current = { ...liveSession.current, messages };
              saveLive();
            }
            resolve(String(event.data.id));
          } else if (event.kind === "session" && liveSession.current) {
            liveSession.current = {
              ...liveSession.current,
              nativeId: String(event.data.sessionId),
            };
            saveLive();
          } else if (event.kind === "metadata") {
            setMetadata((previous) => ({ ...previous, ...event.data }));
            setModels((previous) => mergeAiModels(previous, event.data));
            const nativeModel = typeof event.data.model === "string" ? event.data.model : undefined;
            if (nativeModel && liveSession.current && !profile.model) {
              liveSession.current = { ...liveSession.current, usageModel: nativeModel };
              saveLive();
            }
          } else if (event.kind === "usage") {
            usageRef.current = mergeAiUsage(usageRef.current, event.data);
            setUsage(usageRef.current);
            if (liveSession.current) {
              liveSession.current = { ...liveSession.current, usage: usageRef.current };
              saveLive();
            }
          } else if (event.kind === "status") setRunStatus(String(event.data.status ?? ""));
          else if (event.kind === "error")
            setError(String(event.data.message ?? "Agent fehlgeschlagen."));
        },
      );
    } catch (error) {
      setError(String(error));
    } finally {
      saveLive();
      run.current = null;
      setRunId(null);
      setApprovals([]);
      setRunStatus("");
      input.current?.focus();
    }
  };
  const newChat = () => {
    state.selectSession(null);
    setAllowWrites(false);
    setAllowDdl(false);
    setMentioned([]);
    setReasoning("");
    setEvents([]);
    setApprovals([]);
    setUsage({});
    setView("chat");
    input.current?.focus();
  };
  const cancel = () => {
    if (runId) void aiCancel(runId).catch((error) => setError(String(error)));
  };
  const active = connections.find((entry) => entry.id === activeId);
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(prompt);
  const suggestions = mentionMatch
    ? connections.filter(
        (connection) =>
          connection.name.toLocaleLowerCase().includes(mentionMatch[1].toLocaleLowerCase()) &&
          connection.id !== activeId &&
          !mentioned.includes(connection.id),
      )
    : [];
  const selectMention = (id: string) => {
    const connection = connections.find((entry) => entry.id === id);
    if (!connection || !mentionMatch) return;
    setMentioned((ids) => [...ids, id]);
    setPrompt(`${prompt.slice(0, prompt.length - mentionMatch[1].length - 1)}@${connection.name} `);
    input.current?.focus();
  };
  return (
    <ChatApp
      open={false}
      keyboardShortcut={false}
      className="flex h-full min-h-0 flex-1 rounded-none border-0"
    >
      <aside
        ref={features.ref}
        aria-label="AI-Arbeitsbereich"
        className="flex h-full min-h-0 w-full flex-col bg-background"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
          <span className="mr-auto text-sm font-medium">
            {fullPage ? "AI-Arbeitsbereich" : "AI"}
            {fullPage && status?.version && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {status.version}
              </span>
            )}
          </span>
          {!fullPage && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Im Arbeitsbereich öffnen"
              onClick={() => void navigate({ to: "/ai" })}
            >
              <Maximize2 className="size-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant={view === "history" ? "secondary" : "ghost"}
            aria-label="Gesprächsverlauf"
            disabled={Boolean(runId)}
            onClick={() => setView(view === "history" ? "chat" : "history")}
          >
            <History className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Neues Gespräch"
            disabled={Boolean(runId)}
            onClick={newChat}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            size="icon"
            variant={view === "settings" ? "secondary" : "ghost"}
            aria-label="AI-Einstellungen"
            disabled={Boolean(runId)}
            onClick={() => setView(view === "settings" ? "chat" : "settings")}
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="AI schließen"
            onClick={() => {
              if (fullPage) {
                state.setOpen(false);
                void navigate({ to: "/" });
              } else {
                state.setOpen(false);
                document.getElementById("ai-workspace-trigger")?.focus();
              }
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
        {fullPage && (
          <nav aria-label="AI-Bereiche" className="flex gap-1 border-b px-3 pb-2">
            {(
              [
                { id: "chat", label: "Gespräch" },
                { id: "history", label: "Verlauf" },
                { id: "context", label: "Kontext" },
                { id: "settings", label: "Einstellungen" },
              ] as const
            ).map((tab) => (
              <Button
                key={tab.id}
                size="sm"
                variant={view === tab.id ? "secondary" : "ghost"}
                disabled={Boolean(runId) && tab.id !== "chat"}
                onClick={() => setView(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </nav>
        )}
        {view === "settings" ? (
          <AiSettings
            key={profile.id}
            profile={profile}
            cwd={cwd}
            setCwd={setCwd}
            refresh={refresh}
            onError={setError}
          />
        ) : view === "context" ? (
          <div className="mx-auto min-h-0 w-full max-w-3xl overflow-auto p-5">
            {" "}
            <AiContext
              connections={connections}
              activeId={activeId}
              mentioned={mentioned}
              setMentioned={setMentioned}
              skills={skills}
              selectedSkills={selectedSkills}
              setSelectedSkills={setSelectedSkills}
              servers={state.servers}
              selectedServers={selectedServers}
              setSelectedServers={setSelectedServers}
              allowWrites={allowWrites}
              setAllowWrites={setAllowWrites}
              allowDdl={allowDdl}
              setAllowDdl={setAllowDdl}
              disabled={Boolean(runId)}
            />
            <AiCapabilities metadata={metadata} />
          </div>
        ) : view === "history" ? (
          <div ref={historyFeature.ref} className="min-h-0 flex-1 overflow-auto p-3">
            <h2 className="mb-3 px-1 text-xs font-medium">Gespräche</h2>
            <AISidebar
              ariaLabel="Gesprächsverlauf"
              items={state.sessions
                .filter((entry) => !entry.deleted)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((entry) => ({ id: entry.id, label: entry.title, kind: "file" as const }))}
              activeId={state.sessionId}
              onActiveChange={(id) => {
                if (runId) return;
                const entry = state.sessions.find((session) => session.id === id);
                if (!entry) return;
                resetContext();
                if (entry.profileId !== profile.id) state.selectProfile(entry.profileId);
                state.selectSession(entry.id);
                setCwd(entry.cwd);
                setMentioned(
                  entry.connectionIds.filter(
                    (id) =>
                      id !== activeId && connections.some((connection) => connection.id === id),
                  ),
                );
                setView("chat");
              }}
              onRename={(item, title) => {
                const entry = state.sessions.find((session) => session.id === item.id);
                if (entry && !runId && title.trim())
                  state.saveSession({
                    ...entry,
                    title: title.trim().slice(0, 70),
                    updatedAt: Date.now(),
                  });
              }}
              renderMenu={(item, controls) => (
                <div className="space-y-1">
                  <button
                    type="button"
                    disabled={Boolean(runId)}
                    className="block min-h-8 w-full rounded-md px-2 text-left text-xs hover:bg-muted"
                    onClick={controls.rename}
                  >
                    Umbenennen
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(runId)}
                    aria-label={`${item.label} löschen`}
                    className="block min-h-8 w-full rounded-md px-2 text-left text-xs text-destructive hover:bg-muted"
                    onClick={() => {
                      const entry = state.sessions.find((session) => session.id === item.id);
                      if (entry)
                        state.saveSession({
                          ...entry,
                          deleted: true,
                          messages: [],
                          usage: undefined,
                          usageModel: undefined,
                          usageRequestedModel: undefined,
                          updatedAt: Date.now(),
                        });
                      controls.close();
                    }}
                  >
                    Löschen
                  </button>
                </div>
              )}
              className="text-xs"
            />
            {!state.sessions.some((entry) => !entry.deleted) && (
              <p className="px-1 text-xs text-muted-foreground">Deine Gespräche erscheinen hier.</p>
            )}
          </div>
        ) : (
          <>
            {status &&
              (provider.cli
                ? !status.installed
                : profile.provider !== "compatible" && !status.keyStored) && (
                <div className="mx-4 mt-3 rounded-lg border bg-muted/30 p-3 text-xs">
                  <p>
                    {provider.cli
                      ? `${provider.name} ist nicht eingerichtet.`
                      : "API-Schlüssel fehlt."}
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() => setView("settings")}
                  >
                    Einstellungen öffnen
                  </Button>
                </div>
              )}
            <AiTranscript
              fullPage={fullPage}
              messages={session?.messages ?? []}
              reasoning={reasoning}
              events={events}
              approvals={approvals}
              runId={runId}
              onResolved={resolve}
              onError={setError}
            />
            <div
              className={`shrink-0 px-3 pt-2 pb-3 ${fullPage ? "mx-auto w-full max-w-3xl" : ""}`}
            >
              {suggestions.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Verbindung erwähnen"
                  className="mb-2 max-h-36 overflow-auto rounded-lg border p-1"
                >
                  {suggestions.map((connection) => (
                    <button
                      key={connection.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => selectMention(connection.id)}
                    >
                      @{connection.name}
                    </button>
                  ))}
                </div>
              )}
              {mentioned.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {mentioned.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={Boolean(runId)}
                      aria-label={`Verbindung ${connections.find((connection) => connection.id === id)?.name ?? id} aus Kontext entfernen`}
                      className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      onClick={() => setMentioned((ids) => ids.filter((entry) => entry !== id))}
                    >
                      @{connections.find((connection) => connection.id === id)?.name ?? "Entfernt"}
                      <X className="size-2.5" />
                    </button>
                  ))}
                </div>
              )}
              <PromptInput
                inputRef={input}
                aria-label="Nachricht an AI"
                placeholder="Frage zu deinen Daten …"
                value={prompt}
                onValueChange={setPrompt}
                loading={Boolean(runId)}
                onStop={cancel}
                disabled={
                  loading ||
                  Boolean(
                    status &&
                      (provider.cli
                        ? !status.installed
                        : profile.provider !== "compatible" && !status.keyStored),
                  )
                }
                onSubmit={(text) => send(text)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    suggestions.length
                  ) {
                    event.preventDefault();
                    selectMention(suggestions[0].id);
                  }
                }}
                leadingAction={
                  <>
                    <Popover open={contextOpen} onOpenChange={setContextOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Kontext"
                          className="h-8 min-w-0 shrink gap-1.5 rounded-full px-2 text-[11px]"
                        >
                          <Database className="size-3 shrink-0" />
                          <span className="truncate">
                            {active ? active.name : "Kontext"}
                            {mentioned.length ? ` +${mentioned.length}` : ""}
                          </span>
                          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="top"
                        className="w-80 max-w-[calc(100vw-32px)] rounded-xl p-0"
                        aria-label="AI-Kontext"
                      >
                        {" "}
                        <AiContext
                          connections={connections}
                          activeId={activeId}
                          mentioned={mentioned}
                          setMentioned={setMentioned}
                          skills={skills}
                          selectedSkills={selectedSkills}
                          setSelectedSkills={setSelectedSkills}
                          servers={state.servers}
                          selectedServers={selectedServers}
                          setSelectedServers={setSelectedServers}
                          allowWrites={allowWrites}
                          setAllowWrites={setAllowWrites}
                          allowDdl={allowDdl}
                          setAllowDdl={setAllowDdl}
                          disabled={Boolean(runId)}
                        />
                      </PopoverContent>
                    </Popover>
                    {runId && (
                      <AgentProgress
                        label={runStatus || "Arbeitet …"}
                        className="min-w-0 gap-1 text-[10px] [&>span:first-child]:hidden [&>span:last-child]:hidden"
                      />
                    )}
                  </>
                }
                trailingAction={
                  <>
                    <AiApprovalPicker profile={profile} disabled={Boolean(runId)} />
                    <AiReasoningPicker
                      profile={profile}
                      models={models}
                      disabled={Boolean(runId)}
                    />
                    <AiProviderPicker
                      profile={profile}
                      models={models}
                      disabled={Boolean(runId)}
                      loading={loading}
                      onSelect={(id) => {
                        resetContext();
                        state.selectProfile(id);
                        setView("chat");
                      }}
                    />
                  </>
                }
                className="rounded-xl bg-muted/15 shadow-xs"
              />
              <AiUsage
                data={runId ? usage : (session?.usage ?? usage)}
                profile={
                  runId ? profile : { ...profile, model: session?.usageModel ?? profile.model }
                }
                metadata={{
                  ...metadata,
                  requestedModel: runId
                    ? profile.model
                    : (session?.usageRequestedModel ?? profile.model),
                }}
                messages={session?.messages ?? []}
                prompt={prompt}
                onSettings={() => setView("settings")}
              />
            </div>
          </>
        )}
        {state.persistenceError && (
          <p
            role="alert"
            className="shrink-0 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {state.persistenceError}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <p className="max-h-28 flex-1 overflow-auto whitespace-pre-wrap break-words">{error}</p>
            <button
              type="button"
              aria-label="Fehler schließen"
              className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setError("")}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </aside>
    </ChatApp>
  );
}
