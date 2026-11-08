import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from "lucide";
import { Download, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { SidebarNav } from "@/components/primitives/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { aiAttachable, aiAttachment } from "@/lib/ai/attachments";
import {
  type ChatContextItem,
  contextSuggestions,
  resolveChatContext,
} from "@/lib/ai/chat-context";
import { chatWireMessages, summarizeChat } from "@/lib/ai/chat-history";
import { aiConnections, fastSupported, mergeAiModels } from "@/lib/ai/context";
import { setAiDropHandler } from "@/lib/ai/drop-target";
import { type ChatEditorTarget, handleChatEditorRequest } from "@/lib/ai/editor/chat-edit";
import { editorAiController } from "@/lib/ai/editor/controller";
import { useEditorAiSettings } from "@/lib/ai/editor/settings";
import { activeFeatureContext } from "@/lib/ai/feature-search";
import { AiFigureContext, useAiFigureNumbers } from "@/lib/ai/figures";
import { handleChatIssueRequest } from "@/lib/ai/issue";
import { handleChatNotebookRequest } from "@/lib/ai/notebook";
import { AI_KNOWLEDGE_PROMPT, AI_RULES_PROMPT } from "@/lib/ai/prompts";
import { aiFigures, aiThreadMarkdown } from "@/lib/ai/result";
import { mergeAiRich, normalizeAiRich } from "@/lib/ai/rich";
import { useAiSetupNeeded } from "@/lib/ai/setup";
import { AI_PROVIDERS, type AiSession, aiSessionConnection, useAiStore } from "@/lib/ai/store";
import { aiLatestLeaf, aiThread } from "@/lib/ai/thread";
import { mergeAiUsage } from "@/lib/ai/usage";
import { isReadOnlyConnection, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import {
  type AiAttachment,
  type AiEvent,
  type AiMessage,
  type AiModels,
  type AiStatus,
  aiCancel,
  aiEnvironment,
  aiModels,
  aiRespond,
  aiRun,
  aiSkills,
  aiStatus,
} from "@/lib/db/ai";
import { getFunctionDefinition } from "@/lib/db/transactions";
import type { TableInfo } from "@/lib/db/types";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { isProduction, isProductionLocked } from "@/lib/environments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { IMPORT_FILE_EXTENSIONS } from "@/lib/import-file";
import { useHasNewFeatures } from "@/lib/new-features";
import { useQueryHistoryStore } from "@/lib/query-history";
import { queryTabLabel } from "@/lib/query-tab-title";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { type AiAccessLevel, AiAccessStrip } from "./ai-access-strip";
import { AiApproval } from "./ai-approval";
import { AiApprovalPicker } from "./ai-approval-picker";
import { AiAttachmentChips } from "./ai-attachment-chips";
import { AiBanner } from "./ai-banner";
import { AiCapabilities } from "./ai-capabilities";
import { AiComposerFrame } from "./ai-composer-frame";
import { AiContext } from "./ai-context";
import { AiContextChips } from "./ai-context-chips";
import { AiEmptyHero } from "./ai-empty-hero";
import { AiFastToggle } from "./ai-fast-toggle";
import { AiIssueIntro } from "./ai-issue-intro";
import { AiKnowledgeDialog } from "./ai-knowledge-dialog";
import { AiMentionChips } from "./ai-mention-chips";
import { AiMentionList } from "./ai-mention-list";
import { AiOnboarding } from "./ai-onboarding";
import { AiPanelHeader } from "./ai-panel-header";
import { AiPanelTabs } from "./ai-panel-tabs";
import { AiPlusActions } from "./ai-plus-actions";
import { AiProductionConfirmDialog } from "./ai-production-confirm-dialog";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiQueue } from "./ai-queue";
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
  const router = useRouter();
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
  const [contextItems, setContextItems] = useState<ChatContextItem[]>([]);
  const [editorContext, setEditorContext] = useState(true);
  const editorTabId = useRouterState({
    select: (routerState) => /^\/query\/([^/]+)/.exec(routerState.location.pathname)?.[1],
  });
  const editorTabTitle = useTableTabs((tabsState) => {
    const id = editorTabId ? decodeURIComponent(editorTabId) : null;
    const tab = tabsState.tabs.find((entry) => entry.kind === "query" && entry.id === id);
    return tab?.kind === "query" ? queryTabLabel(tab) || "Abfrage" : null;
  });
  const editorTab: ChatContextItem | null =
    editorContext && editorTabTitle !== null
      ? { id: "tab", kind: "tab", label: `Editor: ${editorTabTitle}` }
      : null;
  const contextFeature = useNewFeatureVisibility<HTMLDivElement>(
    contextItems.length
      ? "ai.chat.context-mentions"
      : editorTab
        ? "ai.chat.editor-context"
        : undefined,
  );

  const [allowWrites, setAllowWrites] = useState(false);
  const [allowDdl, setAllowDdl] = useState(false);
  const [productionGrant, setProductionGrant] = useState<{
    id: string;
    level: "write" | "ddl";
    sessionId: string | null;
  } | null>(null);
  const [productionConfirm, setProductionConfirm] = useState<{
    id: string;
    name: string;
    level: "write" | "ddl";
    sessionId: string | null;
  } | null>(null);
  const accessCap = (connection: SavedConnection | undefined) =>
    !connection || !isProduction(connection)
      ? "ddl"
      : productionGrant?.id === connection.id && productionGrant.sessionId === (session?.id ?? null)
        ? productionGrant.level
        : "read";
  const [runId, setRunId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<AiEvent[]>([]);
  const [queue, setQueue] = useState<
    { id: string; text: string; attachments: AiAttachment[]; context: ChatContextItem[] }[]
  >([]);
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
  const modelScoped = Boolean(
    models.configOptions?.some(
      (option) =>
        option &&
        typeof option === "object" &&
        ((option as Record<string, unknown>).category === "model" ||
          (option as Record<string, unknown>).id === "model"),
    ),
  );
  const probedModel = useRef("");
  useEffect(() => {
    if (loading) probedModel.current = "";
    if (loading || !modelScoped || run.current || probedModel.current === profile.model) return;
    const model = profile.model;
    let live = true;
    const timer = setTimeout(() => {
      void aiModels({ ...discoveryProfile, model }, cwd)
        .then((result) => {
          if (!live || !Array.isArray(result.configOptions)) return;
          probedModel.current = model;
          setModels((current) => ({ ...current, configOptions: result.configOptions }));
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [loading, modelScoped, profile.model, discoveryProfile, cwd]);
  useEffect(() => {
    if ((state.open || fullPage) && view === "chat") input.current?.focus();
  }, [state.open, view, fullPage]);
  const resetContext = () => {
    setSelectedSkills([]);
    setSelectedServers([]);
    setMentioned([]);
    setContextItems([]);
    setApprovals([]);
    setUsage({});
    setAllowWrites(false);
    setAllowDdl(false);
    setProductionGrant(null);
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
  const figureNumbers = useAiFigureNumbers(figures);
  const figureScope = useMemo(
    () => ({
      numbers: figureNumbers,
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
    [figureNumbers, shelf, focused],
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
      const cap = accessCap(current.connections.find((entry) => entry.id === current.activeId));
      const selected = aiConnections(
        current.connections,
        current.activeId,
        mentioned,
        selection.databaseByConnection,
        selection.schemaByConnection,
        productionGrant?.id === current.activeId ? productionGrant.id : null,
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
      if (!session)
        setProductionGrant((grant) =>
          grant && grant.sessionId === null ? { ...grant, sessionId: next.id } : grant,
        );
      onStart?.();
      setRunId(id);
      setApprovals([]);
      setUsage({});
      usageRef.current = {};
      liveSession.current = { ...next, usage: {}, usageModel: profile.model };
      setRunStatus("Startet …");
      const wire = chatWireMessages(turn, base.summary);
      if (wire.summarizeUpTo) {
        const sessionId = next.id;
        void summarizeChat(turn, wire.summarizeUpTo, profile)
          .then((summary) => {
            const stored = useAiStore.getState().sessions.find((entry) => entry.id === sessionId);
            if (!summary || !stored) return;
            if (liveSession.current?.id === sessionId)
              liveSession.current = { ...liveSession.current, summary };
            state.saveSession({ ...stored, summary, updatedAt: Date.now() });
          })
          .catch(() => undefined);
      }
      await aiRun(
        {
          runId: id,
          profile: { ...profile, fast: Boolean(profile.fast) && fastSupported(profile, models) },
          cwd,
          sessionId: resume,
          messages: wire.messages,
          connections: selected,
          activeId: current.activeId,
          skills: selectedSkills.filter((path) => skills.some((skill) => skill.path === path)),
          servers: state.servers.filter(
            (server) => !server.deleted && selectedServers.includes(server.id),
          ),
          allowWrites: allowWrites && cap !== "read",
          allowDdl: allowDdl && cap === "ddl",
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
          } else if (event.kind === "editor") {
            const requestId = String(event.data.id);
            void handleChatEditorRequest(event.data.details, editorTarget())
              .catch((reason) => ({ ok: false, text: String(reason) }))
              .then((answer) => aiRespond(id, requestId, answer))
              .catch(() => undefined);
          } else if (event.kind === "notebook") {
            const requestId = String(event.data.id);
            void handleChatNotebookRequest(event.data.details, () => navigate({ to: "/notebook" }))
              .catch((reason) => ({ ok: false, text: String(reason) }))
              .then((answer) => aiRespond(id, requestId, answer))
              .catch(() => undefined);
          } else if (event.kind === "issue") {
            const requestId = String(event.data.id);
            void handleChatIssueRequest()
              .catch(() => ({ diagnostics: "", screenshot: null }))
              .then((answer) => aiRespond(id, requestId, answer))
              .catch(() => undefined);
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
          else if (event.kind === "notice") toast.info(String(event.data.message ?? ""));
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
  const currentQueryTab = () => {
    const match = /^\/query\/([^/]+)/.exec(router.state.location.pathname);
    const tab = match
      ? useTableTabs
          .getState()
          .tabs.find((entry) => entry.kind === "query" && entry.id === decodeURIComponent(match[1]))
      : undefined;
    return tab?.kind === "query" ? tab : null;
  };
  const currentTabSql = () => {
    const tab = currentQueryTab();
    return tab ? (editorAiController(tab.id)?.text() ?? tab.sql) : null;
  };
  const openQueryTab = (sql: string, title: string) => {
    const tabId = useTableTabs.getState().openQueryTabWithSql(sql, title.slice(0, 40));
    if (router.state.location.pathname === "/ai") useAiStore.getState().setOpen(true);
    void navigate({ to: "/query/$id", params: { id: tabId } });
    return tabId;
  };
  const editorTarget = (): ChatEditorTarget => ({
    tabs: () =>
      useTableTabs
        .getState()
        .tabs.flatMap((tab) =>
          tab.kind === "query" ? [{ id: tab.id, title: queryTabLabel(tab), sql: tab.sql }] : [],
        ),
    visibleId: () => currentQueryTab()?.id ?? null,
    controller: (tabId) => editorAiController(tabId),
    show: async (tabId) => {
      if (currentQueryTab()?.id !== tabId) {
        if (router.state.location.pathname === "/ai") useAiStore.getState().setOpen(true);
        await navigate({ to: "/query/$id", params: { id: tabId } });
      }
      for (let attempt = 0; attempt < 30; attempt++) {
        const controller = editorAiController(tabId);
        if (controller) return controller;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return undefined;
    },
    openTab: openQueryTab,
    loadSource: async (object) => {
      const current = useConnectionsStore.getState();
      const connection = current.connections.find((entry) => entry.id === current.activeId);
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      if (connection.kind !== "oracle")
        throw new Error(
          "object wird nur bei Oracle unterstützt. Quelltext per Abfrage lesen und mit sql öffnen.",
        );
      const database =
        useDbSelectionStore.getState().databaseByConnection[connection.id] ??
        databaseFromConnectionString(connection.connectionString) ??
        undefined;
      const load = (schema: string, name: string) =>
        getFunctionDefinition(
          connection.kind,
          effectiveConnectionString(connection),
          [schema, name, object.type].join("\u001f"),
          database,
        );
      try {
        return await load(object.schema, object.name);
      } catch (reason) {
        const schema = object.schema.toUpperCase();
        const name = object.name.toUpperCase();
        if (schema === object.schema && name === object.name) throw reason;
        return load(schema, name);
      }
    },
  });
  const withContext = async (items: ChatContextItem[], text = "") => {
    const features = activeFeatureContext(text);
    if (!items.length) return features ? { context: features } : {};
    const current = useConnectionsStore.getState();
    const connection = current.connections.find((entry) => entry.id === current.activeId) ?? null;
    const selection = useDbSelectionStore.getState();
    const context = await resolveChatContext(items, {
      queryClient,
      connection,
      database: connection
        ? (selection.databaseByConnection[connection.id] ??
          databaseFromConnectionString(connection.connectionString))
        : null,
      defaultSchema: connection ? (selection.schemaByConnection[connection.id] ?? null) : null,
      tabSql: currentTabSql(),
      tabTitle: currentQueryTab()?.title,
      tabSelection: (() => {
        const tab = currentQueryTab();
        return tab ? (editorAiController(tab.id)?.selectionLabel() ?? null) : null;
      })(),
      recentContext: thread.slice(-4).flatMap((message) => message.context ?? []),
      history: useQueryHistoryStore.getState().entries,
      shareValues: useEditorAiSettings.getState().shareValues,
    }).catch(() => "");
    const combined = [context, features].filter(Boolean).join("\n\n");
    if (!combined) return {};
    return context
      ? { context: combined, contextLabels: items.map((item) => `@${item.label}`) }
      : { context: combined };
  };
  const send = (text = prompt, files = attachments, items = contextItems) => {
    if (!text.trim()) return;
    if (run.current) {
      setQueue((entries) => [
        ...entries,
        { id: crypto.randomUUID(), text: text.trim(), attachments: files, context: items },
      ]);
      setPrompt("");
      setAttachments([]);
      setContextItems([]);
      return;
    }
    const trimmed = text.trim();
    if (editorTab && !items.some((item) => item.kind === "tab")) items = [...items, editorTab];
    void withContext(items, trimmed).then((extra) =>
      runTurn(
        thread,
        {
          id: crypto.randomUUID(),
          parentId: thread.at(-1)?.id ?? null,
          role: "user",
          text: trimmed,
          createdAt: Date.now(),
          ...(files.length ? { attachments: files } : {}),
          ...extra,
        },
        () => {
          setPrompt("");
          setAttachments([]);
          setContextItems([]);
        },
      ),
    );
  };
  const ask = (text: string) => send(text, [], []);
  useEffect(() => {
    if (runId || !queue.length) return;
    setQueue(queue.slice(1));
    send(queue[0].text, queue[0].attachments, queue[0].context);
  });
  const pending = state.pendingPrompt;
  useEffect(() => {
    if (!pending || loading || runId || !(state.open || fullPage)) return;
    const context = state.pendingContext;
    useAiStore.setState({ pendingPrompt: "", pendingContext: [] });
    setView("chat");
    if (setupNeeded) {
      setPrompt(pending);
      setContextItems(context);
    } else send(pending, [], context);
  });
  const attached = state.pendingContext;
  useEffect(() => {
    if (!attached.length || state.pendingPrompt || !(state.open || fullPage)) return;
    useAiStore.setState({ pendingContext: [] });
    setView("chat");
    setContextItems((items) => [
      ...items.filter((item) => !attached.some((entry) => entry.id === item.id)),
      ...attached,
    ]);
    requestAnimationFrame(() => input.current?.focus());
  }, [attached, state.pendingPrompt, state.open, fullPage]);
  const draft = state.pendingDraft;
  useEffect(() => {
    if (!draft || !(state.open || fullPage)) return;
    useAiStore.setState({ pendingDraft: "" });
    setView("chat");
    setPrompt((current) => (current.trim() ? `${current}\n\n${draft}` : draft));
    requestAnimationFrame(() => {
      const element = input.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }, [draft, state.open, fullPage]);
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
      ...(message.context
        ? { context: message.context, contextLabels: message.contextLabels }
        : {}),
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
    setEditorContext(true);
    setAllowWrites(false);
    setAllowDdl(false);
    setProductionGrant(null);
    setMentioned([]);
    setContextItems([]);
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
  const mentionTables = (): TableInfo[] => {
    if (!mentionMatch || !active) return [];
    const database =
      useDbSelectionStore.getState().databaseByConnection[active.id] ??
      databaseFromConnectionString(active.connectionString);
    const objects = queryClient.getQueryData<{ tables?: TableInfo[]; views?: TableInfo[] }>([
      "all-objects",
      active.id,
      database,
    ]);
    return objects?.tables
      ? [...objects.tables, ...(objects.views ?? [])]
      : (queryClient.getQueryData<TableInfo[]>(["all-tables", active.id, database]) ?? []);
  };
  const contextMatches =
    mentionMatch && activeId
      ? contextSuggestions(mentionMatch[1], mentionTables(), contextItems, 6)
      : [];
  const mentionCount = suggestions.length + contextMatches.length;
  const replaceMention = (label: string) => {
    if (!mentionMatch) return;
    setPrompt(`${prompt.slice(0, prompt.length - mentionMatch[1].length - 1)}@${label} `);
    input.current?.focus();
  };
  const selectMention = (id: string) => {
    const connection = connections.find((entry) => entry.id === id);
    if (!connection || !mentionMatch) return;
    setMentioned((ids) => [...ids, id]);
    replaceMention(connection.name);
  };
  const selectContext = (item: ChatContextItem) => {
    setContextItems((items) => [...items, item]);
    replaceMention(item.label);
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
  const cap = accessCap(active);
  const level: AiAccessLevel = locked
    ? "locked"
    : allowDdl && cap === "ddl"
      ? "ddl"
      : allowWrites && cap !== "read"
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
        const rank = ["read", "write", "ddl"];
        if (active && next !== "read" && rank.indexOf(next) > rank.indexOf(cap)) {
          setProductionConfirm({
            id: active.id,
            name: active.name,
            level: next,
            sessionId: session?.id ?? null,
          });
          return;
        }
        setAllowWrites(next !== "read");
        setAllowDdl(next === "ddl");
        if (next === "read") setProductionGrant(null);
        else if (active && isProduction(active))
          setProductionGrant({ id: active.id, level: next, sessionId: session?.id ?? null });
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
      {!thread.length && !minimized && <AiEmptyHero connectionName={active?.name} />}
      {mentionCount > 0 && (
        <AiMentionList
          contexts={contextMatches}
          connections={suggestions}
          onContext={selectContext}
          onConnection={selectMention}
        />
      )}
      {(contextItems.length > 0 || editorTab) && (
        <div ref={contextFeature.ref} className="mb-2">
          <AiContextChips
            items={
              editorTab && !contextItems.some((item) => item.kind === "tab")
                ? [editorTab, ...contextItems]
                : contextItems
            }
            isNew={contextFeature.isNew}
            disabled={busy}
            onRemove={(id) => {
              if (id === "tab") setEditorContext(false);
              setContextItems((items) => items.filter((item) => item.id !== id));
            }}
          />
        </div>
      )}
      {mentioned.length > 0 && (
        <AiMentionChips
          connections={mentioned.map((id) => ({
            id,
            name: connections.find((connection) => connection.id === id)?.name ?? "Entfernt",
          }))}
          disabled={busy}
          onRemove={(id) => setMentioned((ids) => ids.filter((entry) => entry !== id))}
        />
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
        <AiQueue
          entries={queue}
          onRemove={(id) => setQueue((entries) => entries.filter((item) => item.id !== id))}
        />
      )}
      <AiComposerFrame
        minimized={minimized}
        approvals={
          runId && approvals.length > 0
            ? approvals.map((event) => (
                <AiApproval
                  key={String(event.data.id)}
                  event={event}
                  runId={runId}
                  onResolved={resolve}
                  onError={setError}
                />
              ))
            : null
        }
      >
        {strip}
        {productionConfirm && (
          <AiProductionConfirmDialog
            name={productionConfirm.name}
            level={productionConfirm.level}
            onConfirm={() => {
              setAllowWrites(true);
              setAllowDdl(productionConfirm.level === "ddl");
              setProductionGrant({
                id: productionConfirm.id,
                level: productionConfirm.level,
                sessionId: productionConfirm.sessionId,
              });
              setProductionConfirm(null);
            }}
            onClose={() => setProductionConfirm(null)}
          />
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
              mentionCount
            ) {
              event.preventDefault();
              if (contextMatches.length) selectContext(contextMatches[0]);
              else selectMention(suggestions[0].id);
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
              <AiFastToggle profile={profile} models={models} disabled={busy} />
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
      </AiComposerFrame>
      {!thread.length && !minimized && active && !runId && <AiSuggestions onAsk={ask} />}
      {!thread.length && !minimized && <AiIssueIntro />}
    </div>
  );
  const chat = setupNeeded ? (
    onboarding
  ) : (
    <>
      {missingSetup && (
        <AiBanner
          tone="setup"
          action={
            <Button size="xs" variant="secondary" onClick={() => setView("settings")}>
              Einrichten
            </Button>
          }
        >
          {provider.cli ? `${provider.name} ist nicht eingerichtet.` : "API-Schlüssel fehlt."}
        </AiBanner>
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
        <div>
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
        <AiPanelTabs tab={tab} count={figures.length} onTab={setPanelTab} />
      )}
      {fullPage && view === "chat" && thread.length > 0 && (
        <div className="flex h-12 shrink-0 items-center px-5">
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
        <AiBanner tone="error" className={alertMini}>
          {state.persistenceError}
        </AiBanner>
      )}
      {error && (
        <AiBanner tone="error" className={alertMini} onClose={() => setError("")}>
          {error}
        </AiBanner>
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
              <div ref={historyFeature.ref} className="flex bg-sidebar/50">
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
                <div className="flex w-[25rem] shrink-0 flex-col bg-muted/30">
                  <div className="flex h-12 shrink-0 items-center gap-2 px-4">
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
          onDiscoverRules={runId || setupNeeded ? undefined : () => ask(AI_RULES_PROMPT)}
        />
      )}
    </ChatApp>
  );
}
