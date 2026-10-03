import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from "lucide";
import {
  ChevronDown,
  Database,
  History,
  ListPlus,
  Maximize2,
  Minus,
  PanelRightOpen,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { aiAttachable, aiAttachment } from "@/lib/ai/attachments";
import { aiConnections, mergeAiModels } from "@/lib/ai/context";
import { setAiDropHandler } from "@/lib/ai/drop-target";
import { AI_KNOWLEDGE_PROMPT } from "@/lib/ai/prompts";
import { aiThreadMarkdown } from "@/lib/ai/result";
import { mergeAiRich, normalizeAiRich } from "@/lib/ai/rich";
import { useAiSetupNeeded } from "@/lib/ai/setup";
import { AI_PROVIDERS, type AiSession, aiSessionConnection, useAiStore } from "@/lib/ai/store";
import { aiLatestLeaf, aiThread } from "@/lib/ai/thread";
import { mergeAiUsage } from "@/lib/ai/usage";
import { useConnectionsStore } from "@/lib/connections";
import {
  type AiAttachment,
  type AiEvent,
  type AiMessage,
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
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import-file";
import { useHasNewFeatures } from "@/lib/new-features";
import { AiApproval } from "./ai-approval";
import { AiApprovalPicker } from "./ai-approval-picker";
import { AiAttachmentChips } from "./ai-attachment-chips";
import { AiCapabilities } from "./ai-capabilities";
import { AiContext } from "./ai-context";
import { AiKnowledgeDialog } from "./ai-knowledge-dialog";
import { AiOnboarding } from "./ai-onboarding";
import { AiPlusActions } from "./ai-plus-actions";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiReasoningPicker } from "./ai-reasoning-picker";
import { AiSettings } from "./ai-settings";
import { AiSuggestions } from "./ai-suggestions";
import { AiTranscript } from "./ai-transcript";
import { AiUsage } from "./ai-usage";
import { AISidebar } from "./beui/agents/ai-sidebar";
import { ChatApp } from "./beui/agents/chat-app";
import { PromptInput } from "./beui/agents/prompt-input";

export function AiView({ fullPage = false }: { fullPage?: boolean }) {
  const navigate = useNavigate();
  const state = useAiStore();
  const profile = state.profiles.find((entry) => entry.id === state.profileId) ?? state.profiles[0];
  const connections = useConnectionsStore((value) => value.connections);
  const activeId = useConnectionsStore((value) => value.activeId);
  const sessions = state.sessions.filter(
    (entry) => !entry.deleted && aiSessionConnection(entry) === activeId,
  );
  const session = sessions.find((entry) => entry.id === state.sessionId);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [panelView, setView] = useState<"chat" | "settings" | "history">("chat");
  const minimized = state.minimized && !fullPage;
  const view = minimized || (fullPage && panelView === "history") ? "chat" : panelView;
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
  const [approvals, setApprovals] = useState<AiEvent[]>([]);
  const [queue, setQueue] = useState<{ id: string; text: string; attachments: AiAttachment[] }[]>(
    [],
  );
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const queryClient = useQueryClient();
  const plusNew = useHasNewFeatures("ai.chat.plus");
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
  const stopping = useRef(false);
  const approvalTitles = useRef(new Map<string, string>());
  const liveSession = useRef<AiSession | null>(null);
  const usageRef = useRef<Record<string, unknown>>({});
  const features = useNewFeatureVisibility<HTMLElement>("ai.chat");
  const minimizeFeature = useNewFeatureVisibility<HTMLButtonElement>(
    !fullPage && !minimized ? "ai.chat.minimize" : undefined,
  );
  const historyFeature = useNewFeatureVisibility<HTMLDivElement>(
    fullPage || view === "history" ? "ai.history" : undefined,
  );
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider) ?? AI_PROVIDERS[0];
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const [setupNeeded, setSetupNeeded, readyIds] = useAiSetupNeeded(state.open || fullPage);
  const autoPick = useRef(true);
  useEffect(() => {
    if (!autoPick.current || !readyIds.length) return;
    autoPick.current = false;
    if (!readyIds.includes(profile.id) && !session && !run.current)
      useAiStore.getState().selectProfile(readyIds[0]);
  }, [readyIds, profile.id, session]);
  const asideRef = useRef<HTMLElement | null>(null);
  const featureRef = features.ref;
  const setAside = useCallback(
    (element: HTMLElement | null) => {
      asideRef.current = element;
      featureRef(element);
    },
    [featureRef],
  );
  const addFiles = useCallback(async (paths: string[]) => {
    const results = await Promise.allSettled(paths.map((path) => aiAttachment(path)));
    const added = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    for (const result of results)
      if (result.status === "rejected") toast.error(`Datei nicht lesbar: ${String(result.reason)}`);
    setAttachments((files) =>
      [...files, ...added.filter((file) => !files.some((entry) => entry.path === file.path))].slice(
        0,
        10,
      ),
    );
    input.current?.focus();
  }, []);
  const pickFiles = () =>
    void openDialog({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Daten (CSV, Excel, JSON, Parquet)",
          extensions: Object.values(IMPORT_FILE_EXTENSIONS).flat(),
        },
      ],
    }).then((picked) => {
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length) void addFiles(paths);
    });
  const visible = (state.open || fullPage) && !minimized;
  useEffect(() => {
    if (!visible) return;
    return setAiDropHandler((paths, x, y) => {
      const rect = asideRef.current?.getBoundingClientRect();
      if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
      const files = paths.filter(aiAttachable);
      if (!files.length) return false;
      void addFiles(files);
      return true;
    });
  }, [visible, addFiles]);
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
    setApprovals([]);
    setUsage({});
    setAllowWrites(false);
    setAllowDdl(false);
    setAttachments([]);
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
  const thread = aiThread(session);
  const updateLast = (change: (message: AiMessage) => AiMessage) => {
    if (!liveSession.current) return;
    const messages = [...liveSession.current.messages];
    messages[messages.length - 1] = change(messages[messages.length - 1]);
    liveSession.current = { ...liveSession.current, messages };
    saveLive();
  };
  const runTurn = async (history: AiMessage[], user?: AiMessage, onStart?: () => void) => {
    const turn = user ? [...history, user] : history;
    if (!turn.length || run.current) return;
    setError("");
    const id = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const assistant: AiMessage = {
      id: assistantId,
      parentId: turn[turn.length - 1].id ?? null,
      role: "assistant",
      text: "",
      createdAt: Date.now(),
    };
    const base = session ?? {
      id: crypto.randomUUID(),
      title: turn[0].text.slice(0, 70),
      profileId: profile.id,
      nativeId: null,
      cwd,
      messages: [],
      connectionIds: [],
      connectionId: useConnectionsStore.getState().activeId,
      updatedAt: Date.now(),
    };
    const resume =
      user &&
      base.nativeId &&
      (base.nativeLeafId ?? base.messages[base.messages.length - 1]?.id) === history.at(-1)?.id
        ? base.nativeId
        : null;
    let synced = Boolean(resume);
    run.current = id;
    stopping.current = false;
    afterTool.current = false;
    try {
      const current = useConnectionsStore.getState();
      const selection = useDbSelectionStore.getState();
      const selected = aiConnections(
        current.connections,
        current.activeId,
        mentioned,
        selection.databaseByConnection,
        selection.schemaByConnection,
      );
      const files = [
        ...new Map(
          turn.flatMap((message) => message.attachments ?? []).map((file) => [file.path, file]),
        ).values(),
      ].slice(-10);
      const next: AiSession = {
        ...base,
        cwd,
        failed: undefined,
        usageRequestedModel: profile.model,
        connectionIds: selected.map((connection) => connection.id),
        messages: [...base.messages, ...(user ? [user] : []), assistant],
        leafId: assistant.id,
        updatedAt: Date.now(),
      };
      liveSession.current = next;
      state.saveSession(next);
      state.selectSession(next.id);
      onStart?.();
      setRunId(id);
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
          sessionId: resume,
          messages: turn.map(({ role, text }) => ({ role, text })),
          connections: selected,
          activeId: current.activeId,
          skills: selectedSkills.filter((path) => skills.some((skill) => skill.path === path)),
          servers: state.servers.filter(
            (server) => !server.deleted && selectedServers.includes(server.id),
          ),
          allowWrites,
          allowDdl,
          attachments: files,
        },
        (event) => {
          if (run.current !== id) return;
          const blocks = normalizeAiRich(event);
          if (blocks.length)
            updateLast((last) => ({
              ...last,
              rich: mergeAiRich(last.rich, blocks, last.text.length),
            }));
          if (event.kind === "text") {
            updateLast((last) => ({
              ...last,
              text:
                last.text +
                (afterTool.current && last.text && !last.text.endsWith("\n") ? "\n\n" : "") +
                String(event.data.delta ?? ""),
            }));
            afterTool.current = false;
          } else if (event.kind === "reasoning")
            updateLast((last) => ({
              ...last,
              reasoning: (last.reasoning ?? "") + String(event.data.delta ?? ""),
            }));
          else if (event.kind === "tool") {
            afterTool.current = true;
            if (event.data.name === "import_file" && event.data.status === "completed")
              void queryClient.invalidateQueries({ queryKey: ["tables"] });
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
            updateLast((last) => ({
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
            }));
            resolve(String(event.data.id));
          } else if (event.kind === "session" && liveSession.current) {
            synced = true;
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
          else if (event.kind === "error") {
            if (liveSession.current) liveSession.current = { ...liveSession.current, failed: true };
            updateLast((last) => ({
              ...last,
              error: String(event.data.message ?? "Agent fehlgeschlagen."),
            }));
          }
        },
      );
    } catch (error) {
      if (liveSession.current?.leafId === assistantId) {
        liveSession.current = { ...liveSession.current, failed: true };
        updateLast((last) => ({ ...last, error: String(error) }));
      } else setError(String(error));
    } finally {
      if (liveSession.current?.leafId === assistantId) {
        updateLast((last) => ({
          ...last,
          durationMs: Date.now() - (last.createdAt ?? Date.now()),
          ...(stopping.current ? { stopped: true } : {}),
        }));
        if (synced) liveSession.current = { ...liveSession.current, nativeLeafId: assistantId };
        saveLive();
      }
      run.current = null;
      setRunId(null);
      setApprovals([]);
      setRunStatus("");
      input.current?.focus();
    }
  };
  const send = (text = prompt, files = attachments) => {
    if (!text.trim()) return;
    if (run.current) {
      setQueue((entries) => [
        ...entries,
        { id: crypto.randomUUID(), text: text.trim(), attachments: files },
      ]);
      setPrompt("");
      setAttachments([]);
      return;
    }
    void runTurn(
      thread,
      {
        id: crypto.randomUUID(),
        parentId: thread.at(-1)?.id ?? null,
        role: "user",
        text: text.trim(),
        createdAt: Date.now(),
        ...(files.length ? { attachments: files } : {}),
      },
      () => {
        setPrompt("");
        setAttachments([]);
      },
    );
  };
  const ask = (text: string) => send(text, []);
  useEffect(() => {
    if (runId || !queue.length) return;
    setQueue(queue.slice(1));
    send(queue[0].text, queue[0].attachments);
  });
  const pending = state.pendingPrompt;
  useEffect(() => {
    if (!pending || loading || runId || !(state.open || fullPage)) return;
    useAiStore.setState({ pendingPrompt: "" });
    setView("chat");
    if (setupNeeded) setPrompt(pending);
    else send(pending, []);
  });
  const edit = (message: AiMessage, text: string) => {
    const index = thread.indexOf(message);
    if (index < 0 || !text.trim()) return;
    void runTurn(thread.slice(0, index), {
      id: crypto.randomUUID(),
      parentId: thread[index - 1]?.id ?? null,
      role: "user",
      text: text.trim(),
      createdAt: Date.now(),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    });
  };
  const retry = (message: AiMessage) => {
    const index = thread.indexOf(message);
    if (index > 0) void runTurn(thread.slice(0, index));
  };
  const switchBranch = (id: string | undefined) => {
    if (!session || run.current) return;
    state.saveSession({ ...session, leafId: aiLatestLeaf(session, id), updatedAt: Date.now() });
  };
  const newChat = () => {
    state.selectSession(null);
    setAllowWrites(false);
    setAllowDdl(false);
    setMentioned([]);
    setApprovals([]);
    setQueue([]);
    setUsage({});
    setAttachments([]);
    setView("chat");
    input.current?.focus();
  };
  const exportSession = (id: string) => {
    const entry = state.sessions.find((item) => item.id === id);
    if (!entry) return;
    const name = entry.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "gespraech";
    void save({ defaultPath: `${name}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] })
      .then(async (path) => {
        if (!path) return;
        await writeTextFile(path, aiThreadMarkdown(entry.title, aiThread(entry)));
        toast.success("Gespräch exportiert");
      })
      .catch((error) => toast.error(`Export fehlgeschlagen: ${String(error)}`));
  };
  const cancel = () => {
    if (!runId) return;
    stopping.current = true;
    void aiCancel(runId).catch((error) => setError(String(error)));
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
  const historyList = (
    <>
      <h2 className="mb-3 px-1 text-xs font-medium">Gespräche</h2>
      <AISidebar
        ariaLabel="Gesprächsverlauf"
        items={sessions
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((entry) => ({ id: entry.id, label: entry.title, kind: "file" as const }))}
        activeId={state.sessionId}
        renderIcon={(item) => {
          const live = runId && liveSession.current?.id === item.id;
          const failed = state.sessions.find((session) => session.id === item.id)?.failed;
          const [icon, label, tone] = live
            ? approvals.length
              ? [CircleHelp, "Wartet auf Eingabe", "text-amber-500"]
              : [LoaderCircle, "Arbeitet", "animate-spin text-primary"]
            : failed
              ? [CircleX, "Fehlgeschlagen", "text-destructive"]
              : [CircleCheck, "Fertig", "text-emerald-500"];
          return (
            <span title={label} className="grid">
              <MorphIcon icon={icon} className={`size-4 ${tone}`} />
            </span>
          );
        }}
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
              (id) => id !== activeId && connections.some((connection) => connection.id === id),
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
              className="block min-h-8 w-full rounded-md px-2 text-left text-xs hover:bg-muted"
              onClick={() => {
                exportSession(item.id);
                controls.close();
              }}
            >
              Als Markdown exportieren
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
      {!sessions.length && (
        <p className="px-1 text-xs text-muted-foreground">Deine Gespräche erscheinen hier.</p>
      )}
    </>
  );
  const onboarding = (
    <AiOnboarding
      onDone={(id) => {
        resetContext();
        state.selectProfile(id);
        setSetupNeeded(false);
        refresh();
      }}
      onSettings={() => {
        setSetupNeeded(false);
        setView("settings");
      }}
    />
  );
  const settingsButton = (
    <IconButton
      size="icon"
      variant={view === "settings" ? "secondary" : "ghost"}
      aria-label="AI-Einstellungen"
      disabled={Boolean(runId)}
      onClick={() => setView(view === "settings" ? "chat" : "settings")}
    >
      <Settings2 className="size-4" />
    </IconButton>
  );
  const main = (
    <>
      {!fullPage && (
        <div
          className={`shrink-0 items-center gap-1 border-b px-3 ${minimized ? "hidden h-11 pl-2 group-data-active/mini:flex" : "flex h-12"}`}
        >
          {minimized && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Als Seitenleiste öffnen"
              onClick={() => state.setMinimized(false)}
            >
              <PanelRightOpen className="size-4" />
            </Button>
          )}
          <span className="mr-auto min-w-0 truncate text-sm font-medium">
            {minimized ? (session?.title ?? "AI") : "AI"}
          </span>
          {!minimized && (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Im Arbeitsbereich öffnen"
                onClick={() => void navigate({ to: "/ai" })}
              >
                <Maximize2 className="size-4" />
              </Button>
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
              {settingsButton}
              <Button
                ref={minimizeFeature.ref}
                size="icon"
                variant="ghost"
                aria-label="Minimieren"
                onClick={() => state.setMinimized(true)}
              >
                <Minus className="size-4" />
              </Button>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="AI schließen"
            onClick={() => {
              state.setOpen(false);
              document.getElementById("ai-workspace-trigger")?.focus();
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      {view === "settings" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <AiSettings
            key={profile.id}
            profile={profile}
            cwd={cwd}
            setCwd={setCwd}
            refresh={refresh}
            onError={setError}
          />
          <div className="px-4 pb-4">
            <AiCapabilities metadata={metadata} />
          </div>
        </div>
      ) : view === "history" ? (
        <div ref={historyFeature.ref} className="min-h-0 flex-1 overflow-auto p-3">
          {historyList}
        </div>
      ) : setupNeeded ? (
        onboarding
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
          {thread.length > 0 && (
            <div
              className={
                minimized
                  ? "hidden h-[min(26rem,calc(85vh-18rem))] min-h-0 flex-col group-data-active/mini:flex"
                  : "contents"
              }
            >
              <AiTranscript
                messages={thread}
                session={session}
                runId={runId}
                runStatus={runStatus}
                onEdit={edit}
                onRetry={retry}
                onBranch={switchBranch}
                onAsk={ask}
              />
            </div>
          )}
          <div
            className={`mx-auto w-full max-w-[46rem] shrink-0 px-3 pt-2 pb-3 ${thread.length || minimized ? "" : "my-auto"}`}
          >
            {!thread.length && !minimized && (
              <h2 className="pb-6 text-center text-2xl font-normal tracking-tight">
                {active ? `Was möchtest du über ${active.name} wissen?` : "Wie kann ich helfen?"}
              </h2>
            )}
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
            {attachments.length > 0 && (
              <div className="mb-2">
                <AiAttachmentChips
                  files={attachments}
                  onRemove={(path) =>
                    setAttachments((files) => files.filter((file) => file.path !== path))
                  }
                />
              </div>
            )}
            {queue.length > 0 && (
              <ul aria-label="Warteschlange" className="mb-2 space-y-1">
                {queue.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 py-1 pr-1 pl-2.5 text-xs"
                  >
                    <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                    <IconButton
                      aria-label="Aus Warteschlange entfernen"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() =>
                        setQueue((entries) => entries.filter((item) => item.id !== entry.id))
                      }
                    >
                      <X className="size-3" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            {runId && approvals.length > 0 && (
              <div className="max-h-[50vh] space-y-2 overflow-auto rounded-t-xl border border-b-0 border-amber-500/30 bg-amber-500/5 p-2">
                {approvals.map((event) => (
                  <AiApproval
                    key={String(event.data.id)}
                    event={event}
                    runId={runId}
                    onResolved={resolve}
                    onError={setError}
                  />
                ))}
              </div>
            )}
            <PromptInput
              inputRef={input}
              aria-label="Nachricht an AI"
              minRows={minimized ? 1 : undefined}
              placeholder={
                runId && approvals.length
                  ? "Beantworte die Freigabe, um fortzufahren"
                  : "Frage zu deinen Daten …"
              }
              value={prompt}
              onValueChange={setPrompt}
              loading={Boolean(runId)}
              queueable
              onStop={cancel}
              disabled={
                loading ||
                Boolean(runId && approvals.length) ||
                Boolean(
                  status &&
                    (provider.cli
                      ? !status.installed
                      : profile.provider !== "compatible" && !status.keyStored),
                )
              }
              onSubmit={(text) => send(text)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && runId) {
                  event.preventDefault();
                  cancel();
                } else if (
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Anhänge, Wissen, Skills und MCP-Server"
                        className="relative size-8 shrink-0 rounded-full"
                      >
                        <Plus className="size-4" />
                        {plusNew && (
                          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      className="w-72 max-w-[calc(100vw-32px)] rounded-2xl p-0 shadow-lg"
                      aria-label="Skills und MCP-Server"
                    >
                      <AiPlusActions
                        connectionName={active?.name}
                        disabled={Boolean(runId)}
                        onAttach={pickFiles}
                        onKnowledge={() => setKnowledgeOpen(true)}
                      />
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
                        part="tools"
                      />
                    </PopoverContent>
                  </Popover>
                </>
              }
              trailingAction={
                <>
                  <AiApprovalPicker profile={profile} disabled={Boolean(runId)} />
                  <AiReasoningPicker profile={profile} models={models} disabled={Boolean(runId)} />
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
              className={`rounded-xl ${minimized ? "bg-background shadow-lg shadow-black/20 group-not-data-active/mini:flex group-not-data-active/mini:items-center group-not-data-active/mini:gap-1 group-not-data-active/mini:[&>div:last-child]:contents group-not-data-active/mini:[&>div:last-child>div:last-child]:order-2 group-not-data-active/mini:[&>textarea]:order-1 group-not-data-active/mini:[&>textarea]:min-w-0 group-not-data-active/mini:[&>textarea]:flex-1 group-not-data-active/mini:[&>textarea]:pt-0 group-not-data-active/mini:rounded-full group-not-data-active/mini:bg-background/80 group-not-data-active/mini:backdrop-blur-md group-not-data-active/mini:[&>div:last-child>div:last-child>*:not(:last-child)]:hidden group-data-active/mini:shadow-xs" : "bg-muted/15 shadow-xs"} ${runId && approvals.length ? "rounded-t-none" : ""}`}
            />
            <div
              className={`mt-1 items-center justify-between gap-2 ${minimized ? "hidden group-data-active/mini:flex" : "flex"}`}
            >
              <Popover open={contextOpen} onOpenChange={setContextOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Kontext"
                    className="h-6 min-w-0 shrink gap-1.5 rounded-full px-2 text-[11px] text-muted-foreground"
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
                  className="w-72 max-w-[calc(100vw-32px)] rounded-2xl p-0 shadow-lg"
                  aria-label="AI-Kontext"
                >
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
                    part="connections"
                  />
                </PopoverContent>
              </Popover>
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
                messages={thread}
                prompt={prompt}
                onSettings={() => setView("settings")}
              />
            </div>
            {!thread.length && !minimized && active && !runId && <AiSuggestions onAsk={ask} />}
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
    </>
  );
  return (
    <ChatApp
      open={false}
      keyboardShortcut={false}
      className="flex h-full min-h-0 flex-1 rounded-none border-0 group-not-data-active/mini:bg-transparent"
    >
      <aside
        ref={setAside}
        aria-label="AI-Arbeitsbereich"
        className={`flex h-full min-h-0 w-full bg-background group-not-data-active/mini:bg-transparent ${fullPage ? "flex-row" : "flex-col"}`}
      >
        {fullPage && setupNeeded && view === "chat" ? (
          onboarding
        ) : fullPage ? (
          <>
            <div className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
              <div className="flex shrink-0 items-center gap-1 p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 justify-start"
                  disabled={Boolean(runId)}
                  onClick={newChat}
                >
                  <Plus className="size-4" />
                  Neues Gespräch
                </Button>
                {settingsButton}
              </div>
              <div ref={historyFeature.ref} className="min-h-0 flex-1 overflow-auto px-3 pb-3">
                {historyList}
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
          </>
        ) : (
          main
        )}
      </aside>
      {active && (
        <AiKnowledgeDialog
          connectionId={active.id}
          connectionName={active.name}
          open={knowledgeOpen}
          onOpenChange={setKnowledgeOpen}
          onGenerate={runId || setupNeeded ? undefined : () => ask(AI_KNOWLEDGE_PROMPT)}
        />
      )}
    </ChatApp>
  );
}
