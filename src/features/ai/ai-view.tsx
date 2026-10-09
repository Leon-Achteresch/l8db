import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from "lucide";
import { Download, ListPlus, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { SidebarNav } from "@/components/primitives/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { aiAttachable, aiAttachment } from "@/lib/ai/attachments";
import { aiConnections, mergeAiModels } from "@/lib/ai/context";
import { setAiDropHandler } from "@/lib/ai/drop-target";
import { AiFigureContext } from "@/lib/ai/figures";
import { AI_KNOWLEDGE_PROMPT } from "@/lib/ai/prompts";
import { aiFigures, aiThreadMarkdown } from "@/lib/ai/result";
import { mergeAiRich, normalizeAiRich } from "@/lib/ai/rich";
import { useAiSetupNeeded } from "@/lib/ai/setup";
import { AI_PROVIDERS, type AiSession, aiSessionConnection, useAiStore } from "@/lib/ai/store";
import { aiLatestLeaf, aiThread } from "@/lib/ai/thread";
import { mergeAiUsage } from "@/lib/ai/usage";
import { isReadOnlyConnection, useConnectionsStore } from "@/lib/connections";
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
import { isProduction, isProductionLocked } from "@/lib/environments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import-file";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";
import { type AiAccessLevel, AiAccessStrip } from "./ai-access-strip";
import { AiApproval } from "./ai-approval";
import { AiApprovalPicker } from "./ai-approval-picker";
import { AiAttachmentChips } from "./ai-attachment-chips";
import { AiCapabilities } from "./ai-capabilities";
import { AiContext } from "./ai-context";
import { AiKnowledgeDialog } from "./ai-knowledge-dialog";
import { AiOnboarding } from "./ai-onboarding";
import { AiPanelHeader } from "./ai-panel-header";
import { AiPlusActions } from "./ai-plus-actions";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiReasoningPicker } from "./ai-reasoning-picker";
import { AiResultsShelf } from "./ai-results-shelf";
import { AiSettings } from "./ai-settings";
import { AiSuggestions } from "./ai-suggestions";
import { AiTranscript } from "./ai-transcript";
import { AiUsage } from "./ai-usage";
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
  const [panelTab, setPanelTab] = useState<"chat" | "results">("chat");
  const [focused, setFocused] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
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
  const minimizeFeature = useNewFeatureVisibility<HTMLDivElement>(
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
  useEffect(() => {
    const element = asideRef.current;
    if (!fullPage || !element) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 1040));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fullPage]);
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
  const thread = useMemo(() => aiThread(session), [session]);
  const figures = useMemo(() => aiFigures(thread), [thread]);
  const shelf = fullPage && wide && thread.length > 0;
  const focusTimer = useRef<number | undefined>(undefined);
  const figureScope = useMemo(
    () => ({
      numbers: new Map(figures.map((block, index) => [block.id, index + 1])),
      shelf,
      focused,
      focus: (id: string) => {
        document
          .getElementById(`ai-shelf-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setFocused(id);
        window.clearTimeout(focusTimer.current);
        focusTimer.current = window.setTimeout(() => setFocused(null), 1800);
      },
    }),
    [figures, shelf, focused],
  );
  const tab = figures.length && !fullPage ? panelTab : "chat";
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
          if (event.kind !== "status")
            setRunStatus((status) => (status === "Startet …" ? "" : status));
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
    setPanelTab("chat");
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
  const pickSession = (id: string) => {
    if (runId) return;
    const entry = state.sessions.find((session) => session.id === id);
    if (!entry) return;
    resetContext();
    if (entry.profileId !== profile.id) state.selectProfile(entry.profileId);
    state.selectSession(entry.id);
    setCwd(entry.cwd);
    setPanelTab("chat");
    setMentioned(
      entry.connectionIds.filter(
        (id) => id !== activeId && connections.some((connection) => connection.id === id),
      ),
    );
    setView("chat");
  };
  const history = {
    label: "Gesprächsverlauf",
    items: sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((entry) => {
        const live = runId && liveSession.current?.id === entry.id;
        const [icon, label, tone] = live
          ? approvals.length
            ? [CircleHelp, "Wartet auf Eingabe", "text-amber-500"]
            : [LoaderCircle, "Arbeitet", "animate-spin text-primary"]
          : entry.failed
            ? [CircleX, "Fehlgeschlagen", "text-destructive"]
            : [CircleCheck, "Fertig", "text-emerald-500"];
        return {
          id: entry.id,
          label: entry.title,
          icon: (
            <span title={label} className="grid shrink-0">
              <MorphIcon icon={icon} className={`size-3.5 ${tone}`} />
            </span>
          ),
        };
      }),
    activeId: state.sessionId,
    busy: Boolean(runId),
    empty: (
      <p className="px-2 py-1 text-xs text-muted-foreground">Deine Gespräche erscheinen hier.</p>
    ),
    onPick: pickSession,
    onRename: (id: string, title: string) => {
      const entry = state.sessions.find((session) => session.id === id);
      if (entry && !runId)
        state.saveSession({ ...entry, title: title.slice(0, 70), updatedAt: Date.now() });
    },
    menu: (item: { id: string; label: string }, rename: () => void) => (
      <>
        <IconMenuItem
          icon={<Pencil />}
          label="Umbenennen"
          disabled={Boolean(runId)}
          onSelect={rename}
        />
        <IconMenuItem
          icon={<Download />}
          label="Als Markdown exportieren"
          onSelect={() => exportSession(item.id)}
        />
        <IconMenuSeparator />
        <IconMenuItem
          icon={<Trash2 />}
          label={`${item.label} löschen`}
          variant="destructive"
          disabled={Boolean(runId)}
          onSelect={() => {
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
          }}
        />
      </>
    ),
  };
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
  const busy = Boolean(runId);
  const missingSetup = Boolean(
    status &&
      (provider.cli ? !status.installed : profile.provider !== "compatible" && !status.keyStored),
  );
  const locked = Boolean(
    active && (active.readOnly || isReadOnlyConnection(active) || isProductionLocked(active)),
  );
  const level: AiAccessLevel = locked
    ? "locked"
    : allowDdl
      ? "ddl"
      : allowWrites
        ? "write"
        : "read";
  const settingsButton = (
    <IconButton
      size="icon"
      variant={view === "settings" ? "secondary" : "ghost"}
      aria-label="KI-Einstellungen"
      disabled={busy}
      onClick={() => setView(view === "settings" ? "chat" : "settings")}
    >
      <Settings2 className="size-4" />
    </IconButton>
  );
  const strip = (
    <AiAccessStrip
      level={level}
      production={Boolean(active && isProduction(active))}
      connectionLabel={`${active ? active.name : "Kontext"}${mentioned.length ? ` +${mentioned.length}` : ""}`}
      connections={
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
          disabled={busy}
          part="connections"
        />
      }
      onLevel={(next) => {
        setAllowWrites(next !== "read");
        setAllowDdl(next === "ddl");
      }}
      disabled={busy}
      approval={<AiApprovalPicker profile={profile} disabled={busy} />}
      trailing={
        <AiUsage
          data={runId ? usage : (session?.usage ?? usage)}
          profile={runId ? profile : { ...profile, model: session?.usageModel ?? profile.model }}
          metadata={{
            ...metadata,
            requestedModel: runId ? profile.model : (session?.usageRequestedModel ?? profile.model),
          }}
          messages={thread}
          prompt={prompt}
          onSettings={() => setView("settings")}
        />
      }
      className={minimized ? "hidden group-data-active/mini:flex" : undefined}
    />
  );
  const composer = (
    <div
      className={cn(
        "mx-auto w-full shrink-0 px-3 pt-2 pb-3",
        fullPage ? "max-w-[46rem]" : "",
        !thread.length && !minimized && tab === "chat" && "my-auto",
      )}
    >
      {!thread.length && !minimized && (
        <div className="px-1 pb-5">
          <h2 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {active ? `Was möchtest du über ${active.name} wissen?` : "Wie kann ich helfen?"}
          </h2>
          <p className="mt-1.5 max-w-[34rem] text-[13px] leading-relaxed text-muted-foreground">
            Frag in Alltagssprache. Du bekommst eine kurze Antwort, Diagramme und Tabellen zum
            Exportieren und auf Wunsch das SQL dahinter.
          </p>
        </div>
      )}
      {suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Verbindung erwähnen"
          className="mb-2 max-h-36 overflow-auto rounded-xl border bg-popover p-1 shadow-sm"
        >
          {suggestions.map((connection) => (
            <button
              key={connection.id}
              type="button"
              role="option"
              aria-selected={false}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              disabled={busy}
              aria-label={`Verbindung ${connections.find((connection) => connection.id === id)?.name ?? id} aus Kontext entfernen`}
              className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
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
              className="flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 text-xs"
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
        <div className="max-h-[50vh] space-y-2 overflow-auto rounded-t-2xl border border-b-0 border-amber-500/35 bg-amber-500/[0.07] p-2">
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
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/4%),0_10px_28px_-16px_oklch(0_0_0/18%)] transition-colors focus-within:border-foreground/20",
          runId && approvals.length > 0 && "rounded-t-none border-amber-500/35",
          minimized &&
            "group-not-data-active/mini:overflow-visible group-not-data-active/mini:border-0 group-not-data-active/mini:bg-transparent group-not-data-active/mini:shadow-none",
        )}
      >
        {strip}
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
          loading={busy}
          queueable
          onStop={cancel}
          disabled={loading || Boolean(runId && approvals.length) || missingSetup}
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
                    disabled={busy}
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
                    disabled={busy}
                    part="tools"
                  />
                </PopoverContent>
              </Popover>
              {minimized && active && (
                <span
                  title={`Zugriff: ${level === "write" ? "Daten ändern" : level === "ddl" ? "Schema ändern" : level === "locked" ? "Schreibgeschützt" : "Nur lesen"}`}
                  className="flex max-w-32 shrink-0 items-center gap-1.5 pr-1 text-xs font-medium text-muted-foreground group-data-active/mini:hidden"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      level === "write"
                        ? "bg-amber-500"
                        : level === "ddl"
                          ? "bg-red-500"
                          : "bg-emerald-500",
                    )}
                  />
                  <span className="truncate">{active.name}</span>
                </span>
              )}
            </>
          }
          trailingAction={
            <>
              <AiReasoningPicker profile={profile} models={models} disabled={busy} />
              <AiProviderPicker
                profile={profile}
                models={models}
                disabled={busy}
                loading={loading}
                onSelect={(id) => {
                  resetContext();
                  state.selectProfile(id);
                  setView("chat");
                }}
              />
            </>
          }
          className={cn(
            "rounded-none border-0 bg-transparent px-2 pt-2 pb-2 focus-within:border-0",
            minimized &&
              "group-not-data-active/mini:flex group-not-data-active/mini:items-center group-not-data-active/mini:gap-1 group-not-data-active/mini:[&>div:last-child]:contents group-not-data-active/mini:[&>div:last-child>div:last-child]:order-2 group-not-data-active/mini:[&>textarea]:order-1 group-not-data-active/mini:[&>textarea]:min-w-0 group-not-data-active/mini:[&>textarea]:flex-1 group-not-data-active/mini:[&>textarea]:pt-0 group-not-data-active/mini:rounded-full group-not-data-active/mini:border group-not-data-active/mini:bg-background/80 group-not-data-active/mini:shadow-lg group-not-data-active/mini:shadow-black/20 group-not-data-active/mini:backdrop-blur-md group-not-data-active/mini:[&>div:last-child>div:last-child>*:not(:last-child)]:hidden",
          )}
        />
      </div>
      {!thread.length && !minimized && active && !runId && <AiSuggestions onAsk={ask} />}
    </div>
  );
  const chat = setupNeeded ? (
    onboarding
  ) : (
    <>
      {missingSetup && (
        <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-xs">
          <p className="min-w-0 flex-1">
            {provider.cli ? `${provider.name} ist nicht eingerichtet.` : "API-Schlüssel fehlt."}
          </p>
          <Button size="sm" variant="outline" onClick={() => setView("settings")}>
            Einstellungen öffnen
          </Button>
        </div>
      )}
      {tab === "results" ? (
        <AiResultsShelf figures={figures} />
      ) : (
        thread.length > 0 && (
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
              runStatus={approvals.length ? "Wartet auf deine Freigabe" : runStatus}
              onEdit={edit}
              onRetry={retry}
              onBranch={switchBranch}
              onAsk={ask}
            />
          </div>
        )
      )}
      {composer}
    </>
  );
  const alertMini =
    minimized &&
    "group-not-data-active/mini:mx-4 group-not-data-active/mini:mt-2 group-not-data-active/mini:rounded-2xl group-not-data-active/mini:border group-not-data-active/mini:border-destructive/25 group-not-data-active/mini:bg-background/90 group-not-data-active/mini:shadow-lg group-not-data-active/mini:shadow-black/10 group-not-data-active/mini:backdrop-blur-md";
  const main = (
    <>
      {!fullPage && (
        <div className={cn(!figures.length || view !== "chat" || minimized ? "border-b" : "")}>
          <AiPanelHeader
            title={session?.title || "KI-Assistent"}
            view={view}
            minimized={minimized}
            busy={busy}
            minimizeNew={minimizeFeature.isNew}
            minimizeRef={minimizeFeature.ref}
            onBack={() => setView("chat")}
            onNew={newChat}
            onHistory={() => setView("history")}
            onSettings={() => setView("settings")}
            onFullPage={() => void navigate({ to: "/ai" })}
            onMinimize={() => state.setMinimized(true)}
            onRestore={() => state.setMinimized(false)}
            onClose={() => {
              state.setOpen(false);
              document.getElementById("ai-workspace-trigger")?.focus();
            }}
          />
        </div>
      )}
      {!fullPage && !minimized && view === "chat" && figures.length > 0 && (
        <div role="tablist" aria-label="Ansicht" className="flex shrink-0 gap-4 border-b px-4">
          {(
            [
              ["chat", "Gespräch"],
              ["results", "Ergebnisse"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setPanelTab(id)}
              className={cn(
                "-mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
                tab === id && "border-primary font-medium text-foreground",
              )}
            >
              {label}
              {id === "results" && (
                <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
                  {figures.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {fullPage && view === "chat" && thread.length > 0 && (
        <div className="flex h-12 shrink-0 items-center border-b px-5">
          <h2 className="min-w-0 truncate text-[13px] font-semibold">{session?.title}</h2>
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
        <div ref={historyFeature.ref} className="min-h-0 flex-1 px-1 pb-1">
          <SidebarNav {...history} />
        </div>
      ) : (
        chat
      )}
      {state.persistenceError && (
        <p
          role="alert"
          className={cn(
            "shrink-0 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive",
            alertMini,
          )}
        >
          {state.persistenceError}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className={cn(
            "flex shrink-0 items-start gap-2 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive",
            alertMini,
          )}
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
      <AiFigureContext value={figureScope}>
        <aside
          ref={setAside}
          aria-label="AI-Arbeitsbereich"
          className={`flex h-full min-h-0 w-full bg-background group-not-data-active/mini:bg-transparent ${fullPage ? "flex-row" : "flex-col"}`}
        >
          {fullPage && setupNeeded && view === "chat" ? (
            onboarding
          ) : fullPage ? (
            <>
              <div ref={historyFeature.ref} className="flex border-r bg-sidebar/50">
                <SidebarNav
                  {...history}
                  title="Gespräche"
                  collapsible
                  onNew={newChat}
                  headerActions={settingsButton}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
              {shelf && view === "chat" && (
                <div className="flex w-[25rem] shrink-0 flex-col border-l bg-muted/25">
                  <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                    <h2 className="text-[13px] font-semibold">Ergebnisse</h2>
                    {figures.length > 0 && (
                      <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
                        {figures.length}
                      </span>
                    )}
                  </div>
                  <AiResultsShelf figures={figures} />
                </div>
              )}
            </>
          ) : (
            main
          )}
        </aside>
      </AiFigureContext>
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
