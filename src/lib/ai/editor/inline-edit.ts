import { explainQuery } from "@/lib/db/rows";
import { monaco } from "@/lib/monaco";
import { supports } from "@/lib/providers";
import { lintUnknownTables } from "@/lib/sql-lint";
import { splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { useEditorCheckpoints } from "./checkpoints";
import { isAbort, runEditorAi } from "./client";
import { compactError } from "./compact";
import { type EditorAiEnvironment, editRequest } from "./context";
import { applyModelEdit } from "./edit-format";
import { currentEditorAiEnvironment } from "./environment";
import { applyHunks, type DiffHunk, diffLines } from "./line-diff";
import { EDITOR_AI_ACTION_LABELS, type EditorAiAction, useEditorAiMetrics } from "./metrics";
import { OverlayZone } from "./overlay-zone";
import { useEditorAiSettings } from "./settings";

export type EditPhase = "input" | "running" | "review" | "error";
export type HunkDecision = "pending" | "accepted" | "rejected";

export interface HunkSnapshot {
  index: number;
  decision: HunkDecision;
  removed: string[];
  added: number;
  node: HTMLElement | null;
}

export interface EditSnapshot {
  id: string;
  phase: EditPhase;
  action: EditorAiAction;
  instruction: string;
  placeholder: string;
  status: string;
  error: string;
  warning: string;
  streamed: number;
  model: string;
  usage: { input: number; output: number; cached: number } | null;
  earlier: string[];
  promptNode: HTMLElement;
  hunks: HunkSnapshot[];
  pending: number;
  font: { family: string; size: number; lineHeight: number };
}

export interface EditStart {
  action: EditorAiAction;
  start: number;
  end: number;
  instruction?: string;
  placeholder?: string;
  extra?: string;
  autoRun?: boolean;
}

const TYPE_MS = 600;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const READ_ONLY_START = /^\s*(select|with|values|table|show|explain)\b/i;
const WRITE_WORD = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke)\b/i;
const BIND_PARAM = /(^|[^:]):[A-Za-z_]\w*|\?|\$\d+|&\w+/;

function zoneNode(): HTMLElement {
  const node = document.createElement("div");
  node.dataset.aiZone = "";
  node.className = "l8db-ai-zone";
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "wheel"])
    node.addEventListener(type, stop);
  return node;
}

export async function validateEdit(
  env: EditorAiEnvironment,
  before: string,
  after: string,
  explain = explainQuery,
): Promise<string> {
  const objects = [...env.registry.tables, ...env.registry.views];
  const known = new Set(lintUnknownTables(before, objects).map((item) => item.message));
  const unknown = lintUnknownTables(after, objects).filter((item) => !known.has(item.message));
  if (unknown.length)
    return `Unknown tables: ${[...new Set(unknown.map((item) => item.message))].join("; ")}`;
  const connection = env.connection;
  if (!useEditorAiSettings.getState().validate || !connection || !supports(connection, "explain"))
    return "";
  const statements = splitSqlStatements(after, connection.kind).statements.filter((statement) =>
    statement.text.trim(),
  );
  const first = statements[0]?.text.trim();
  if (
    !first ||
    statements.length > 3 ||
    !statements.every(
      (statement) =>
        READ_ONLY_START.test(statement.text) &&
        !WRITE_WORD.test(statement.text) &&
        !BIND_PARAM.test(statement.text),
    )
  )
    return "";
  try {
    await explain(
      connection.kind,
      effectiveConnectionString(connection),
      first.replace(/;\s*$/, ""),
      false,
      env.database ?? undefined,
    );
    return "";
  } catch (error) {
    return compactError(first, { message: String(error) });
  }
}

export class InlineEditSession {
  readonly id = crypto.randomUUID();
  private listeners = new Set<() => void>();
  private snapshot: EditSnapshot;
  private abort: AbortController | null = null;
  private base = "";
  private hunks: DiffHunk[] = [];
  private decisions: HunkDecision[] = [];
  private region: monaco.editor.IEditorDecorationsCollection;
  private added: monaco.editor.IEditorDecorationsCollection;
  private promptZone!: OverlayZone;
  private promptHeight = 56;
  private hunkZones: OverlayZone[] = [];
  private applying = false;
  private checkpoint = "";
  private disposed = false;
  private contentSub: monaco.IDisposable;
  private lastNotify = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly editorId: string,
    private readonly start: EditStart,
    private readonly onClose: (session: InlineEditSession) => void,
  ) {
    const model = this.model();
    this.region = editor.createDecorationsCollection([
      {
        range: monaco.Range.fromPositions(
          model.getPositionAt(start.start),
          model.getPositionAt(start.end),
        ),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
      },
    ]);
    this.added = editor.createDecorationsCollection([]);
    this.snapshot = {
      id: this.id,
      phase: "input",
      action: start.action,
      instruction: start.instruction ?? "",
      placeholder: start.placeholder ?? "Was soll die KI ändern?",
      status: "",
      error: "",
      warning: "",
      streamed: 0,
      model: "",
      usage: null,
      earlier: [],
      promptNode: zoneNode(),
      hunks: [],
      pending: 0,
      font: this.font(),
    };
    this.promptZone = new OverlayZone(editor, this.snapshot.promptNode);
    this.layoutPrompt();
    this.contentSub = editor.onDidChangeModelContent((event) => {
      if (this.applying || this.disposed) return;
      if (event.isFlush) this.close();
      else if (this.snapshot.phase === "review") this.finish();
    });
    if (start.autoRun) void this.submit(start.instruction ?? "");
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private font() {
    const info = this.editor.getOption(monaco.editor.EditorOption.fontInfo);
    return { family: info.fontFamily, size: info.fontSize, lineHeight: info.lineHeight };
  }

  private model(): monaco.editor.ITextModel {
    const model = this.editor.getModel();
    if (!model) throw new Error("Editor ohne Modell");
    return model;
  }

  private set(patch: Partial<EditSnapshot>, throttle = false) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (throttle && performance.now() - this.lastNotify < 80) {
      if (!this.notifyTimer)
        this.notifyTimer = setTimeout(() => {
          this.notifyTimer = undefined;
          this.emit();
        }, 80);
      return;
    }
    this.emit();
  }

  private emit() {
    this.lastNotify = performance.now();
    for (const listener of this.listeners) listener();
  }

  private regionOffsets(): { start: number; end: number } {
    const model = this.model();
    const range = this.region.getRange(0);
    if (!range) return { start: 0, end: 0 };
    return {
      start: model.getOffsetAt(range.getStartPosition()),
      end: model.getOffsetAt(range.getEndPosition()),
    };
  }

  private regionText(): string {
    const { start, end } = this.regionOffsets();
    return this.model().getValue().slice(start, end);
  }

  private startLine(): number {
    return this.region.getRange(0)?.startLineNumber ?? 1;
  }

  setPromptHeight = (height: number) => {
    const next = Math.max(40, Math.ceil(height));
    if (Math.abs(next - this.promptHeight) < 2) return;
    this.promptHeight = next;
    this.layoutPrompt();
  };

  private layoutPrompt() {
    if (this.disposed) return;
    this.editor.changeViewZones((accessor) =>
      this.promptZone.place(accessor, {
        afterLineNumber: Math.max(0, this.startLine() - 1),
        heightInPx: this.promptHeight,
        ordinal: 0,
      }),
    );
  }

  private replaceRegion(text: string) {
    const model = this.model();
    const { start, end } = this.regionOffsets();
    const range = monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end));
    if (model.getValueInRange(range) !== text) {
      this.applying = true;
      try {
        this.editor.pushUndoStop();
        this.editor.executeEdits("l8db-ai", [{ range, text, forceMoveMarkers: true }]);
        this.editor.pushUndoStop();
      } finally {
        this.applying = false;
      }
    }
    this.region.set([
      {
        range: monaco.Range.fromPositions(
          model.getPositionAt(start),
          model.getPositionAt(start + text.length),
        ),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
      },
    ]);
  }

  async submit(instruction: string) {
    if (this.disposed || this.snapshot.phase === "running") return;
    const text = instruction.trim() || this.start.instruction?.trim() || "";
    if (!text && !["fix", "optimize", "comment", "cte", "testdata"].includes(this.start.action)) {
      this.set({ error: "Beschreibe kurz, was geändert werden soll." });
      return;
    }
    if (this.snapshot.phase === "review") {
      this.decisions = this.decisions.map((decision) =>
        decision === "pending" ? "accepted" : decision,
      );
      this.clearReview();
      this.snapshot = {
        ...this.snapshot,
        earlier: [...this.snapshot.earlier, this.snapshot.instruction].filter(Boolean),
      };
    }
    const sent = this.regionText();
    this.base = sent;
    const model = this.model();
    const { start, end } = this.regionOffsets();
    const abort = new AbortController();
    this.abort = abort;
    this.set({
      phase: "running",
      instruction: text,
      status: "Kontext wird vorbereitet …",
      error: "",
      warning: "",
      streamed: 0,
    });
    const env = currentEditorAiEnvironment();
    const metrics = useEditorAiMetrics.getState();
    try {
      const prepared = await editRequest(env, {
        action: this.start.action,
        instruction: text,
        sql: model.getValue(),
        start,
        end,
        extra: this.start.extra,
        earlier: this.snapshot.earlier,
      });
      let messages = prepared.messages;
      let result = "";
      let problem = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        this.set({ status: attempt ? "Korrigiert …" : "Schreibt …", streamed: 0 });
        const response = await runEditorAi({
          action: this.start.action,
          cached: prepared.cached,
          messages,
          maxTokens: prepared.maxTokens,
          signal: abort.signal,
          onDelta: (partial) => this.set({ streamed: partial.length }, true),
        });
        this.set({ model: response.model, usage: response.usage });
        const applied = response.truncated
          ? {
              ok: false as const,
              error:
                "Die Antwort wurde am Token-Limit abgeschnitten. Nutze kleinere SEARCH/REPLACE-Blöcke.",
            }
          : applyModelEdit(sent, response.text);
        problem = applied.ok ? "" : applied.error;
        if (applied.ok) {
          result = applied.text;
          if (!sent.trim() && result) {
            const value = model.getValue();
            if (start > 0 && value[start - 1] !== "\n") result = `\n${result}`;
            if (!result.endsWith("\n") && value.slice(end).trim()) result = `${result}\n`;
          }
          this.set({ status: "Prüft …" });
          problem = await validateEdit(env, sent, result);
        }
        if (!problem || attempt === 1 || abort.signal.aborted) break;
        metrics.retry(this.start.action);
        messages = [
          ...prepared.messages,
          { role: "assistant", text: response.text.trim() || "(empty answer)" },
          {
            role: "user",
            text: `Problem with your answer: ${problem}\nAnswer again in the same format and fix only that problem.`,
          },
        ];
      }
      if (this.disposed) return;
      if (abort.signal.aborted) {
        this.set({ phase: "input", status: "" });
        return;
      }
      if (this.regionText() !== sent) {
        this.set({
          phase: "error",
          status: "",
          error: "Der Text wurde während der Generierung geändert. Erneut versuchen.",
        });
        return;
      }
      if (!result && problem) {
        this.set({ phase: "error", status: "", error: problem });
        return;
      }
      this.enterReview(result, problem);
    } catch (error) {
      if (this.disposed) return;
      if (isAbort(error)) this.set({ phase: "input", status: "" });
      else this.set({ phase: "error", status: "", error: String(error).replace(/^Error: /, "") });
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  async applyChat(next: string, label: string): Promise<string> {
    if (this.disposed) return "Der Editor wurde geschlossen.";
    if (this.snapshot.phase === "running") return "Der Editor wird gerade geändert.";
    if (this.snapshot.phase === "review") this.clearReview();
    else this.base = this.regionText();
    this.saveCheckpoint(label);
    this.set({ phase: "running", instruction: label, status: "KI-Chat schreibt …", error: "" });
    const readOnly = this.editor.getOption(monaco.editor.EditorOption.readOnly);
    this.editor.updateOptions({ readOnly: true });
    let completed = false;
    try {
      completed = await this.typeIn(next);
    } finally {
      if (!this.disposed) this.editor.updateOptions({ readOnly });
    }
    if (this.disposed) return "Der Editor wurde während der Änderung geschlossen.";
    if (!completed) {
      this.close();
      return 'Der Text wurde während der Änderung von außen geändert. Mit action "read" neu lesen.';
    }
    if (next === this.base) {
      this.close();
      return "";
    }
    this.enterReview(next, "");
    return "";
  }

  private async typeIn(next: string): Promise<boolean> {
    const current = this.regionText();
    const limit = Math.min(current.length, next.length);
    let prefix = 0;
    while (prefix < limit && current[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    while (suffix > 0 && current[current.length - suffix - 1] !== "\n") suffix--;
    const insert = next.slice(prefix, next.length - suffix);
    const model = this.model();
    const at = this.regionOffsets().start + prefix;
    let shown = current.length - prefix - suffix;
    let typed = 0;
    const began = performance.now();
    let version = model.getVersionId();
    model.pushStackElement();
    while (!this.disposed && model.getVersionId() === version) {
      const target = Math.min(
        insert.length,
        Math.ceil((insert.length * (performance.now() - began)) / TYPE_MS),
      );
      const from = model.getPositionAt(at + typed);
      const to = model.getPositionAt(at + shown);
      this.applying = true;
      try {
        model.pushEditOperations(
          [],
          [
            {
              range: monaco.Range.fromPositions(from, to),
              text: insert.slice(typed, target),
              forceMoveMarkers: true,
            },
          ],
          () => null,
        );
      } finally {
        this.applying = false;
      }
      typed = target;
      shown = target;
      version = model.getVersionId();
      const caret = model.getPositionAt(at + typed);
      this.added.set([
        {
          range: monaco.Range.fromPositions(model.getPositionAt(at), caret),
          options: { className: "l8db-ai-typing" },
        },
      ]);
      this.editor.revealPositionInCenterIfOutsideViewport(caret);
      if (typed >= insert.length) break;
      await nextFrame();
    }
    model.pushStackElement();
    this.added.clear();
    if (this.disposed) return false;
    this.region.set([
      {
        range: monaco.Range.fromPositions(
          model.getPositionAt(this.regionOffsets().start),
          model.getPositionAt(model.getValueLength()),
        ),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
        },
      },
    ]);
    return typed >= insert.length;
  }

  private saveCheckpoint(label: string) {
    if (!this.checkpoint)
      this.checkpoint = useEditorCheckpoints.getState().add(this.editorId, {
        label,
        before: this.model().getValue(),
      });
  }

  private enterReview(next: string, warning: string) {
    if (next === this.base) {
      this.set({ phase: "input", status: "", warning: "Die KI hat keine Änderung vorgeschlagen." });
      return;
    }
    this.saveCheckpoint(this.snapshot.instruction || EDITOR_AI_ACTION_LABELS[this.start.action]);
    this.hunks = diffLines(this.base, next);
    this.decisions = this.hunks.map(() => "pending");
    this.replaceRegion(next);
    this.set({ phase: "review", status: "", warning: warning ? `Hinweis: ${warning}` : "" });
    this.render();
  }

  private displayed(): string {
    return applyHunks(
      this.base,
      this.hunks,
      this.decisions.map((decision) => decision !== "rejected"),
    );
  }

  private clearReview() {
    this.added.clear();
    if (this.hunkZones.length)
      this.editor.changeViewZones((accessor) => {
        for (const zone of this.hunkZones) zone.remove(accessor);
      });
    for (const zone of this.hunkZones) zone.dispose();
    this.hunkZones = [];
    this.snapshot = { ...this.snapshot, hunks: [], pending: 0 };
  }

  private render() {
    this.clearReview();
    const first = this.startLine();
    const lineHeight = this.editor.getOption(monaco.editor.EditorOption.lineHeight);
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const hunks: HunkSnapshot[] = [];
    let delta = 0;
    const zones: { after: number; height: number; node: HTMLElement; index: number }[] = [];
    this.hunks.forEach((hunk, index) => {
      const decision = this.decisions[index];
      const start = hunk.newStart + delta;
      if (decision === "rejected") {
        delta += hunk.oldLines.length - hunk.newLines.length;
        return;
      }
      if (decision !== "pending") return;
      const line = first + start - 1;
      if (hunk.newLines.length)
        decorations.push({
          range: new monaco.Range(line, 1, line + hunk.newLines.length - 1, 1),
          options: {
            isWholeLine: true,
            className: "l8db-ai-added",
            linesDecorationsClassName: "l8db-ai-added-gutter",
          },
        });
      const node = zoneNode();
      node.classList.add("l8db-ai-hunk");
      zones.push({
        after: Math.max(0, line - 1),
        height: hunk.oldLines.length * lineHeight + 26,
        node,
        index,
      });
      hunks.push({
        index,
        decision,
        removed: hunk.oldLines,
        added: hunk.newLines.length,
        node,
      });
    });
    this.added.set(decorations);
    this.editor.changeViewZones((accessor) => {
      this.hunkZones = zones.map((zone) => {
        const overlay = new OverlayZone(this.editor, zone.node);
        overlay.place(accessor, {
          afterLineNumber: zone.after,
          heightInPx: zone.height,
          ordinal: 1 + zone.index,
        });
        return overlay;
      });
    });
    this.layoutPrompt();
    this.set({ hunks, pending: hunks.length, font: this.font() });
  }

  accept(index: number) {
    if (this.decisions[index] !== "pending") return;
    this.decisions[index] = "accepted";
    this.afterDecision();
  }

  reject(index: number) {
    if (this.decisions[index] !== "pending") return;
    this.decisions[index] = "rejected";
    this.replaceRegion(this.displayed());
    this.afterDecision();
  }

  acceptAll() {
    if (this.snapshot.phase !== "review") return;
    this.decisions = this.decisions.map((decision) =>
      decision === "pending" ? "accepted" : decision,
    );
    this.finish();
  }

  rejectAll() {
    if (this.snapshot.phase !== "review") return;
    this.decisions = this.decisions.map((decision) =>
      decision === "pending" ? "rejected" : decision,
    );
    this.replaceRegion(this.displayed());
    this.finish();
  }

  private afterDecision() {
    if (this.decisions.every((decision) => decision !== "pending")) this.finish();
    else this.render();
  }

  private finish() {
    const accepted = this.decisions.filter((decision) => decision !== "rejected").length;
    const metrics = useEditorAiMetrics.getState();
    if (this.decisions.length)
      metrics.outcome(
        this.start.action,
        accepted === this.decisions.length ? "accepted" : accepted === 0 ? "rejected" : "partial",
      );
    this.close();
    this.editor.focus();
  }

  cancel() {
    if (this.snapshot.phase === "running") this.abort?.abort();
    else if (this.snapshot.phase === "review") this.editor.focus();
    else this.close();
  }

  close() {
    if (this.disposed) return;
    this.dispose();
    this.onClose(this);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    clearTimeout(this.notifyTimer);
    this.contentSub.dispose();
    this.added.clear();
    this.region.clear();
    this.editor.changeViewZones((accessor) => {
      this.promptZone.remove(accessor);
      for (const zone of this.hunkZones) zone.remove(accessor);
    });
    this.promptZone.dispose();
    for (const zone of this.hunkZones) zone.dispose();
    this.hunkZones = [];
    this.listeners.clear();
  }
}
