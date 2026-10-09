import { type Hotkey, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { toast } from "sonner";
import { useAiStore } from "@/lib/ai/store";
import type { DatabaseKind } from "@/lib/db";
import { explainQuery } from "@/lib/db/rows";
import { commandById, useHotkeysStore } from "@/lib/hotkeys";
import { monaco } from "@/lib/monaco";
import { supports } from "@/lib/providers";
import { sqlErrorMarkers } from "@/lib/sql-diagnostics/markers";
import { effectiveConnectionString } from "@/lib/ssh";
import { askDraft, explainPrompt } from "./chat-prompts";
import { useEditorCheckpoints } from "./checkpoints";
import { editorAiProfile, editorAiSupported } from "./client";
import { compactError, compactExplain } from "./compact";
import { currentEditorAiEnvironment } from "./environment";
import { type EditStart, InlineEditSession } from "./inline-edit";
import type { EditorAiAction } from "./metrics";
import { recentEdits } from "./monaco-ghost";
import { findRenameProposal, identifierAt, type RenameProposal } from "./rename";
import { useEditorAiSettings } from "./settings";
import { insertionAfter, resolveTarget, statementBounds } from "./targets";

export interface EditorAiErrorSource {
  message: string;
  text?: string;
  base?: number;
}

export interface EditorAiOptions {
  editorId: string;
  getError: () => EditorAiErrorSource | null;
}

const MAX_RECENT_EDITS = 4;
const RENAME_DELAY_MS = 650;
const controllers = new Map<string, EditorAiController>();

export function editorAiController(id: string): EditorAiController | undefined {
  return controllers.get(id);
}

export function controllerForModel(
  model: monaco.editor.ITextModel,
): EditorAiController | undefined {
  for (const controller of controllers.values()) if (controller.hasModel(model)) return controller;
  return undefined;
}

function hotkeyMatches(event: KeyboardEvent, id: string): boolean {
  const command = commandById(id);
  if (!command) return false;
  const override = useHotkeysStore.getState().overrides[id];
  const keys =
    override === undefined ? [command.defaultHotkey, ...(command.aliases ?? [])] : [override];
  return keys.some((key) => key && matchesKeyboardEvent(event, key as Hotkey));
}

function dialect(): string | undefined {
  return currentEditorAiEnvironment().connection?.kind;
}

function isReadOnlySql(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql) && !/\b(insert|update|delete|merge)\b/i.test(sql);
}

export class EditorAiController {
  private session: InlineEditSession | null = null;
  private listeners = new Set<() => void>();
  private disposables: monaco.IDisposable[] = [];
  private renameKey: monaco.editor.IContextKey<boolean>;
  private errorKey: monaco.editor.IContextKey<boolean>;
  private renameDecorations: monaco.editor.IEditorDecorationsCollection;
  private renameWidget: monaco.editor.IContentWidget | null = null;
  private proposal: RenameProposal | null = null;
  private wordBefore: { line: number; start: number; word: string } | null = null;
  private editing = false;
  private renameTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly options: EditorAiOptions,
  ) {
    controllers.set(options.editorId, this);
    this.renameKey = editor.createContextKey("l8dbAiRenameHint", false);
    this.errorKey = editor.createContextKey("l8dbAiHasError", false);
    editor.createContextKey("l8dbAiEnabled", true);
    this.renameDecorations = editor.createDecorationsCollection([]);
    this.disposables.push(
      editor.onDidChangeModelContent((event) => this.onContent(event)),
      editor.onDidChangeCursorPosition(() => this.onCursor()),
      editor.addAction({
        id: "l8db.ai.rename.apply",
        label: "KI: Umbenennung übernehmen",
        precondition:
          "l8dbAiRenameHint && !suggestWidgetVisible && !inlineSuggestionVisible && !inSnippetMode && !editorTabMovesFocus",
        keybindings: [monaco.KeyCode.Tab],
        run: () => this.applyRename(),
      }),
      editor.addAction({
        id: "l8db.ai.rename.dismiss",
        label: "KI: Umbenennung verwerfen",
        precondition: "l8dbAiRenameHint",
        keybindings: [monaco.KeyCode.Escape],
        run: () => this.clearRename(),
      }),
      ...this.menuActions(),
    );
    this.onCursor();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSession = () => this.session;

  get id() {
    return this.options.editorId;
  }

  hasModel(model: monaco.editor.ITextModel): boolean {
    return this.editor.getModel() === model;
  }

  restoreCheckpoint(id: string): boolean {
    const model = this.model();
    const checkpoint = useEditorCheckpoints
      .getState()
      .byEditor[this.options.editorId]?.find((entry) => entry.id === id);
    if (!model || !checkpoint) return false;
    this.session?.close();
    this.clearRename();
    this.editor.pushUndoStop();
    this.editor.executeEdits("l8db-ai-checkpoint", [
      { range: model.getFullModelRange(), text: checkpoint.before, forceMoveMarkers: true },
    ]);
    this.editor.pushUndoStop();
    this.editor.focus();
    return true;
  }

  runAt(offset: number, action: "explain" | "optimize" | "edit") {
    const model = this.model();
    if (!model || !this.ready()) return;
    const position = model.getPositionAt(offset);
    this.editor.setSelection(monaco.Selection.fromPositions(position, position));
    this.editor.focus();
    if (action === "explain") this.explain();
    else if (action === "optimize") void this.optimize();
    else this.startEdit("edit");
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private menuActions(): monaco.IDisposable[] {
    const entries: [string, string, number, () => void, string?][] = [
      ["l8db.ai.edit", "KI: Bearbeiten …", 1, () => this.startEdit("edit")],
      ["l8db.ai.ask", "KI: Im Chat fragen", 2, () => this.askInChat()],
      ["l8db.ai.explain", "KI: Erklären", 3, () => this.explain()],
      ["l8db.ai.fix", "KI: Fehler beheben", 4, () => this.fix(), "l8dbAiHasError"],
      ["l8db.ai.optimize", "KI: Optimieren", 5, () => void this.optimize()],
      ["l8db.ai.comment", "KI: Kommentare ergänzen", 6, () => this.startEdit("comment", true)],
      ["l8db.ai.cte", "KI: In CTEs umwandeln", 7, () => this.startEdit("cte", true)],
      ["l8db.ai.dialect", "KI: In anderen Dialekt übersetzen …", 8, () => this.startDialect()],
      ["l8db.ai.testdata", "KI: Testdaten erzeugen", 9, () => this.testData()],
    ];
    return entries.map(([id, label, order, run, precondition]) =>
      this.editor.addAction({
        id,
        label,
        contextMenuGroupId: "0_ai",
        contextMenuOrder: order,
        precondition,
        run: () => {
          if (this.ready()) run();
        },
      }),
    );
  }

  ready(): boolean {
    if (!useEditorAiSettings.getState().enabled) {
      toast.message("KI im Editor ist ausgeschaltet.", {
        description: "Einstellungen → SQL-Editor → KI im Editor",
      });
      return false;
    }
    try {
      const profile = editorAiProfile();
      if (!editorAiSupported(profile)) {
        toast.error("Editor-KI braucht Claude Code, Codex oder einen API- bzw. lokalen Anbieter.");
        return false;
      }
      return true;
    } catch (error) {
      toast.error(String(error).replace(/^Error: /, ""));
      return false;
    }
  }

  setError(error: EditorAiErrorSource | null) {
    this.errorKey.set(Boolean(error));
  }

  private model() {
    return this.editor.getModel();
  }

  private selectionOffsets() {
    const model = this.model();
    const selection = this.editor.getSelection();
    if (!model || !selection) return null;
    return {
      text: model.getValue(),
      start: model.getOffsetAt(selection.getStartPosition()),
      end: model.getOffsetAt(selection.getEndPosition()),
    };
  }

  startEdit(action: EditorAiAction, autoRun = false, extra?: Partial<EditStart>) {
    const current = this.selectionOffsets();
    if (!current) return;
    const target = resolveTarget(current.text, current.start, current.end, dialect());
    this.open({
      action,
      start: extra?.start ?? target.start,
      end: extra?.end ?? target.end,
      instruction: extra?.instruction ?? target.instruction,
      placeholder: extra?.placeholder ?? this.placeholder(target.mode),
      extra: extra?.extra,
      autoRun: autoRun || extra?.autoRun,
    });
  }

  private placeholder(mode: string): string {
    if (mode === "selection") return "Auswahl ändern, z. B. „nur aktive Kunden“ …";
    if (mode === "generate") return "Neue Abfrage beschreiben …";
    if (mode === "comment")
      return "Enter erzeugt SQL aus dem Kommentar, oder genauer beschreiben …";
    return "Abfrage ändern, z. B. „nach Monat gruppieren“ …";
  }

  open(start: EditStart) {
    this.session?.close();
    this.clearRename();
    this.session = new InlineEditSession(this.editor, this.options.editorId, start, (session) => {
      if (this.session === session) {
        this.session = null;
        this.emit();
      }
    });
    this.emit();
  }

  private startDialect() {
    this.startEdit("dialect", false, {
      instruction: "Übersetze in den SQL-Dialekt: ",
      placeholder: "Ziel-Dialekt, z. B. MySQL, SQL Server, Oracle …",
    });
  }

  private testData() {
    const current = this.selectionOffsets();
    if (!current) return;
    const target = resolveTarget(current.text, current.start, current.end, dialect());
    const position = insertionAfter(current.text, target.end);
    this.open({
      action: "testdata",
      start: position,
      end: position,
      autoRun: true,
      extra: `Statement for which test data is needed:\n\`\`\`sql\n${current.text.slice(target.start, target.end)}\n\`\`\``,
    });
  }

  private statementText(): string {
    const current = this.selectionOffsets();
    if (!current) return "";
    if (current.end > current.start) return current.text.slice(current.start, current.end);
    const bounds = statementBounds(current.text, current.start, dialect());
    return bounds ? current.text.slice(bounds.start, bounds.end) : current.text;
  }

  explain(sql = this.statementText()) {
    if (!sql.trim()) return;
    useAiStore.getState().ask(explainPrompt(sql));
  }

  askInChat() {
    const sql = this.statementText();
    useAiStore.getState().draft(sql.trim() ? askDraft(sql) : "");
  }

  fix() {
    const error = this.options.getError();
    const model = this.model();
    if (!error || !model) {
      toast.message("Kein Fehler zum Beheben vorhanden.");
      return;
    }
    const text = model.getValue();
    const source = error.text ?? text;
    const marker = sqlErrorMarkers(
      error.message,
      source,
      error.base ?? 0,
      dialect() as DatabaseKind | undefined,
    ).find((entry) => entry.start >= 0);
    const anchor = marker?.start ?? error.base ?? this.selectionOffsets()?.start ?? 0;
    const bounds = statementBounds(text, Math.min(anchor, text.length), dialect()) ?? {
      start: 0,
      end: text.length,
    };
    const target = resolveTarget(text, bounds.start, bounds.end, dialect());
    const statement = text.slice(target.start, target.end);
    this.open({
      action: "fix",
      start: target.start,
      end: target.end,
      autoRun: true,
      extra: compactError(statement, {
        message: error.message,
        position: marker ? marker.start - target.start + 1 : null,
      }),
    });
  }

  async optimize() {
    const current = this.selectionOffsets();
    if (!current) return;
    const target = resolveTarget(current.text, current.start, current.end, dialect());
    const sql = current.text.slice(target.start, target.end);
    const env = currentEditorAiEnvironment();
    let extra = "";
    if (env.connection && supports(env.connection, "explain") && isReadOnlySql(sql)) {
      try {
        const plan = await explainQuery(
          env.connection.kind,
          effectiveConnectionString(env.connection),
          sql.trim().replace(/;\s*$/, ""),
          false,
          env.database ?? undefined,
        );
        extra = `Execution plan (estimated, compacted):\n${compactExplain(plan)}`;
      } catch {
        extra = "";
      }
    }
    this.open({
      action: "optimize",
      start: target.start,
      end: target.end,
      autoRun: true,
      extra,
    });
  }

  handleKeydown = (event: KeyboardEvent): boolean => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("[data-ai-zone]")) return false;
    const session = this.session;
    const phase = session?.getSnapshot().phase;
    if (session && phase === "review") {
      if (matchesKeyboardEvent(event, "Mod+Enter" as Hotkey)) {
        session.acceptAll();
        return true;
      }
      if (matchesKeyboardEvent(event, "Mod+Backspace" as Hotkey)) {
        session.rejectAll();
        return true;
      }
    }
    if (session && phase === "running" && event.key === "Escape") {
      session.cancel();
      return true;
    }
    if (hotkeyMatches(event, "query.aiEdit")) {
      if (this.ready()) this.startEdit("edit");
      return true;
    }
    if (hotkeyMatches(event, "query.aiAsk")) {
      if (this.ready()) this.askInChat();
      return true;
    }
    return false;
  };

  private onContent(event: monaco.editor.IModelContentChangedEvent) {
    this.editing = true;
    queueMicrotask(() => {
      this.editing = false;
    });
    const model = this.model();
    if (!model) return;
    if (event.isFlush) {
      this.clearRename();
      recentEdits.delete(model);
      return;
    }
    if (this.proposal) this.clearRename();
    const edits = recentEdits.get(model) ?? [];
    for (const change of event.changes) {
      const added = change.text.trim();
      if (!added && !change.rangeLength) continue;
      const line = change.range.startLineNumber;
      const summary = added
        ? `line ${line}: +${added.slice(0, 120)}`
        : `line ${line}: deleted ${change.rangeLength} chars`;
      if (edits.at(-1)?.startsWith(`line ${line}:`) && added) edits[edits.length - 1] = summary;
      else edits.push(summary);
    }
    recentEdits.set(model, edits.slice(-MAX_RECENT_EDITS));
    clearTimeout(this.renameTimer);
    if (useEditorAiSettings.getState().nextEdit && !this.session)
      this.renameTimer = setTimeout(() => this.checkRename(), RENAME_DELAY_MS);
  }

  private onCursor() {
    if (this.editing) return;
    const model = this.model();
    const position = this.editor.getPosition();
    if (!model || !position) return;
    const line = model.getLineContent(position.lineNumber);
    const span = identifierAt(line, position.column - 1);
    const same =
      this.wordBefore &&
      span &&
      this.wordBefore.line === position.lineNumber &&
      this.wordBefore.start === span.start;
    if (this.proposal && !same) this.clearRename();
    if (!same) {
      clearTimeout(this.renameTimer);
      this.wordBefore = span
        ? { line: position.lineNumber, start: span.start, word: span.word }
        : null;
    }
  }

  private checkRename() {
    const model = this.model();
    const position = this.editor.getPosition();
    const before = this.wordBefore;
    if (!model || !position || !before || before.line !== position.lineNumber) return;
    const line = model.getLineContent(position.lineNumber);
    const span = identifierAt(line, position.column - 1);
    if (!span || span.start !== before.start || span.word === before.word) return;
    const text = model.getValue();
    const lineOffset = model.getOffsetAt({ lineNumber: position.lineNumber, column: 1 });
    const edited = { start: lineOffset + span.start, end: lineOffset + span.end };
    const scope = statementBounds(text, edited.start, dialect()) ?? { start: 0, end: text.length };
    const proposal = findRenameProposal(text, scope, edited, before.word, span.word);
    if (!proposal) return;
    this.showRename(model, proposal, position);
  }

  private showRename(
    model: monaco.editor.ITextModel,
    proposal: RenameProposal,
    position: monaco.Position,
  ) {
    this.proposal = proposal;
    this.renameKey.set(true);
    this.editor.trigger("l8db-ai", "editor.action.inlineSuggest.hide", null);
    this.renameDecorations.set(
      proposal.ranges.map((range) => ({
        range: monaco.Range.fromPositions(
          model.getPositionAt(range.start),
          model.getPositionAt(range.end),
        ),
        options: {
          inlineClassName: "l8db-ai-rename-target",
          hoverMessage: { value: `Tab: in \`${proposal.newName}\` umbenennen` },
        },
      })),
    );
    const node = document.createElement("div");
    node.className = "l8db-ai-rename-hint";
    node.textContent = `⇥ ${proposal.ranges.length} weitere${proposal.ranges.length === 1 ? "s" : ""} Vorkommen von ${proposal.oldName} umbenennen`;
    if (this.renameWidget) this.editor.removeContentWidget(this.renameWidget);
    this.renameWidget = {
      getId: () => "l8db.ai.rename-hint",
      getDomNode: () => node,
      getPosition: () => ({
        position,
        preference: [
          monaco.editor.ContentWidgetPositionPreference.BELOW,
          monaco.editor.ContentWidgetPositionPreference.ABOVE,
        ],
      }),
    };
    this.editor.addContentWidget(this.renameWidget);
  }

  private applyRename() {
    const model = this.model();
    const proposal = this.proposal;
    if (!model || !proposal) return;
    const ranges = this.renameDecorations.getRanges();
    this.clearRename();
    this.editor.pushUndoStop();
    this.editor.executeEdits(
      "l8db-ai-rename",
      ranges.map((range) => ({ range, text: proposal.newName })),
    );
    this.editor.pushUndoStop();
    this.wordBefore = null;
  }

  clearRename() {
    if (!this.proposal && !this.renameWidget) return;
    this.proposal = null;
    this.renameKey.set(false);
    this.renameDecorations.clear();
    if (this.renameWidget) this.editor.removeContentWidget(this.renameWidget);
    this.renameWidget = null;
  }

  dispose() {
    clearTimeout(this.renameTimer);
    this.session?.dispose();
    this.session = null;
    this.clearRename();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    this.listeners.clear();
    if (controllers.get(this.options.editorId) === this) controllers.delete(this.options.editorId);
  }
}
