import { useAiStore } from "@/lib/ai/store";
import { monaco } from "@/lib/monaco";
import { attached } from "@/lib/monaco-intellisense/context";
import { editorAiProfile, inlineSupported, isAbort, runEditorAi } from "./client";
import { inlineRequest } from "./context";
import { currentEditorAiEnvironment } from "./environment";
import {
  cleanCompletion,
  fromCache,
  type GhostCacheEntry,
  shouldRequest,
  singleLineIfNeeded,
} from "./ghost-text";
import { useEditorAiMetrics } from "./metrics";
import { fnv1a } from "./prompts";
import { useEditorAiSettings } from "./settings";

const WINDOW_BEFORE = 8_000;
const WINDOW_AFTER = 3_000;
const ERROR_PAUSE_MS = 30_000;

export const ghostCounters = { requests: 0, cacheHits: 0, skipped: 0, cancelled: 0 };
export const recentEdits = new WeakMap<monaco.editor.ITextModel, string[]>();

const cache = new WeakMap<monaco.editor.ITextModel, GhostCacheEntry>();
let pausedUntil = 0;

function sleep(ms: number, token: monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) return resolve(false);
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(!token.isCancellationRequested);
    }, ms);
    const listener = token.onCancellationRequested(() => {
      clearTimeout(timer);
      listener.dispose();
      resolve(false);
    });
  });
}

function cacheKey(model: monaco.editor.ITextModel, line: number): string {
  const start = model.getOffsetAt({ lineNumber: line, column: 1 });
  const before = model.getValueInRange(
    monaco.Range.fromPositions(model.getPositionAt(Math.max(0, start - 300)), {
      lineNumber: line,
      column: 1,
    }),
  );
  return `${model.uri.toString()}:${line}:${fnv1a(before)}`;
}

function item(
  text: string,
  position: monaco.Position,
  lineLength: number,
  lineSuffix: string,
): monaco.languages.InlineCompletion {
  const endColumn = text.includes("\n") && !lineSuffix.trim() ? lineLength + 1 : position.column;
  return {
    insertText: text,
    range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, endColumn),
  };
}

export async function provideGhostText(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context: monaco.languages.InlineCompletionContext,
  token: monaco.CancellationToken,
): Promise<monaco.languages.InlineCompletions> {
  const empty = { items: [] };
  const settings = useEditorAiSettings.getState();
  if (!attached.has(model) || !settings.enabled || !settings.inline) return empty;
  const lineText = model.getLineContent(position.lineNumber);
  const linePrefix = lineText.slice(0, position.column - 1);
  const lineSuffix = lineText.slice(position.column - 1);
  const offset = model.getOffsetAt(position);
  const windowStart = Math.max(0, offset - WINDOW_BEFORE);
  const windowEnd = Math.min(model.getValueLength(), offset + WINDOW_AFTER);
  const windowText = model.getValueInRange(
    monaco.Range.fromPositions(model.getPositionAt(windowStart), model.getPositionAt(windowEnd)),
  );
  if (!shouldRequest(linePrefix, lineSuffix, windowText)) {
    ghostCounters.skipped++;
    return empty;
  }
  const key = cacheKey(model, position.lineNumber);
  const cached = fromCache(cache.get(model) ?? null, key, linePrefix);
  if (cached) {
    ghostCounters.cacheHits++;
    useEditorAiMetrics.getState().localHit("inline");
    return {
      items: [item(singleLineIfNeeded(cached, lineSuffix), position, lineText.length, lineSuffix)],
    };
  }
  if (Date.now() < pausedUntil) return empty;
  let profile: ReturnType<typeof editorAiProfile>;
  try {
    profile = editorAiProfile();
  } catch {
    return empty;
  }
  if (!inlineSupported(profile)) return empty;
  const explicit = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
  if (!explicit && !(await sleep(settings.inlineDelay, token))) {
    ghostCounters.cancelled++;
    return empty;
  }
  const controller = new AbortController();
  const cancel = token.onCancellationRequested(() => controller.abort());
  try {
    const prepared = await inlineRequest(
      currentEditorAiEnvironment(),
      windowText,
      offset - windowStart,
      recentEdits.get(model) ?? [],
    );
    if (token.isCancellationRequested) {
      ghostCounters.cancelled++;
      return empty;
    }
    ghostCounters.requests++;
    const response = await runEditorAi({
      action: "inline",
      profile,
      cached: prepared.cached,
      messages: prepared.messages,
      maxTokens: prepared.maxTokens,
      stop: prepared.stop,
      signal: controller.signal,
    });
    const suffix = windowText.slice(offset - windowStart);
    const text = cleanCompletion(response.text, linePrefix, suffix);
    if (!text || token.isCancellationRequested) return empty;
    cache.set(model, { key, prefix: linePrefix, text });
    return {
      items: [item(singleLineIfNeeded(text, lineSuffix), position, lineText.length, lineSuffix)],
    };
  } catch (error) {
    if (isAbort(error)) ghostCounters.cancelled++;
    else pausedUntil = Date.now() + ERROR_PAUSE_MS;
    return empty;
  } finally {
    cancel.dispose();
  }
}

export function resumeGhostText() {
  pausedUntil = 0;
}

useEditorAiSettings.subscribe(resumeGhostText);
useAiStore.subscribe((state, previous) => {
  if (state.profiles !== previous.profiles || state.profileId !== previous.profileId)
    resumeGhostText();
});

for (const language of ["sql", "plsql"]) {
  monaco.languages.registerInlineCompletionsProvider(language, {
    displayName: "l8db KI",
    provideInlineCompletions: provideGhostText,
    handleEndOfLifetime(_completions, _item, reason, summary) {
      const metrics = useEditorAiMetrics.getState();
      if (reason.kind === monaco.languages.InlineCompletionEndOfLifeReasonKind.Accepted)
        metrics.outcome("inline", "accepted");
      else if (summary.partiallyAccepted > 0) metrics.outcome("inline", "partial");
      else if (reason.kind === monaco.languages.InlineCompletionEndOfLifeReasonKind.Rejected)
        metrics.outcome("inline", "rejected");
    },
    disposeInlineCompletions() {},
  });
}
