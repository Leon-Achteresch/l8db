import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { mergeAiUsage, summarizeAiUsage } from "@/lib/ai/usage";
import { type AiProfile, aiComplete, aiCompleteCancel } from "@/lib/db/ai";
import { type EditorAiAction, useEditorAiMetrics } from "./metrics";
import { fnv1a } from "./prompts";
import { useEditorAiSettings } from "./settings";

const CLI_EDITOR = new Set(["claude", "codex"]);
const FAST_ACTIONS = new Set<EditorAiAction>(["inline", "comment", "testdata", "summary"]);

export class EditorAiUnavailable extends Error {}

export function editorAiProfile(): AiProfile {
  const ai = useAiStore.getState();
  const { profileId } = useEditorAiSettings.getState();
  const profile =
    ai.profiles.find((entry) => entry.id === profileId) ??
    ai.profiles.find((entry) => entry.id === ai.profileId) ??
    ai.profiles[0];
  if (!profile) throw new EditorAiUnavailable("Kein KI-Anbieter eingerichtet.");
  return profile;
}

export function isCliProfile(profile: AiProfile): boolean {
  return AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli ?? false;
}

export function editorAiSupported(profile: AiProfile): boolean {
  return !isCliProfile(profile) || CLI_EDITOR.has(profile.provider);
}

export function inlineSupported(profile: AiProfile): boolean {
  return !isCliProfile(profile);
}

export function routedProfile(profile: AiProfile, action: EditorAiAction): AiProfile {
  const { fastModel } = useEditorAiSettings.getState();
  const fast = FAST_ACTIONS.has(action);
  return {
    ...profile,
    model:
      fast && fastModel.trim() && profile.id === editorAiProfile().id
        ? fastModel.trim()
        : profile.model,
    effort: fast ? "" : profile.effort,
    approval: "",
  };
}

export interface EditorAiRequest {
  action: EditorAiAction;
  cached: string;
  system?: string;
  messages: { role: "user" | "assistant"; text: string }[];
  maxTokens: number;
  stop?: string[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  profile?: AiProfile;
}

export interface EditorAiResponse {
  text: string;
  truncated: boolean;
  model: string;
  usage: { input: number; output: number; cached: number };
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    String(error).includes("Abgebrochen")
  );
}

export async function runEditorAi(request: EditorAiRequest): Promise<EditorAiResponse> {
  const base = request.profile ?? editorAiProfile();
  if (!editorAiSupported(base))
    throw new EditorAiUnavailable(
      "Editor-KI braucht Claude Code, Codex oder einen API- bzw. lokalen Anbieter.",
    );
  if (request.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
  const profile = routedProfile(base, request.action);
  const runId = crypto.randomUUID();
  const started = performance.now();
  let text = "";
  let usage: Record<string, unknown> = {};
  let model = profile.model;
  const abort = () => void aiCompleteCancel(runId).catch(() => undefined);
  request.signal?.addEventListener("abort", abort, { once: true });
  const metrics = useEditorAiMetrics.getState();
  try {
    const result = await aiComplete(
      {
        runId,
        profile,
        cached: request.cached,
        system: request.system ?? "",
        messages: request.messages,
        maxTokens: request.maxTokens,
        stop: request.stop,
        cacheKey: profile.provider === "openai" ? fnv1a(request.cached) : undefined,
      },
      (event) => {
        if (event.kind === "text") {
          text += String(event.data.delta ?? "");
          request.onDelta?.(text);
        } else if (event.kind === "usage") usage = mergeAiUsage(usage, event.data);
        else if (event.kind === "metadata" && typeof event.data.model === "string")
          model = event.data.model;
      },
    );
    if (request.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    const finalText = result.text || text;
    const summary = summarizeAiUsage(usage, profile, { model: result.model || model }, [
      ...request.messages.map((message) => ({ ...message })),
      { role: "assistant", text: finalText },
    ]);
    metrics.record(request.action, {
      input: summary.input,
      output: summary.output,
      cached: summary.cached,
      written: summary.written,
      cost: summary.cost,
      latencyMs: performance.now() - started,
    });
    return {
      text: finalText,
      truncated: result.truncated,
      model: result.model || model,
      usage: { input: summary.input, output: summary.output, cached: summary.cached },
    };
  } catch (error) {
    const cancelled = request.signal?.aborted || isAbort(error);
    metrics.fail(request.action, Boolean(cancelled));
    if (cancelled) throw new DOMException("Abgebrochen", "AbortError");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    request.signal?.removeEventListener("abort", abort);
  }
}
