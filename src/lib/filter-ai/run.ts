import { editorAiProfile, editorAiSupported, runEditorAi } from "@/lib/ai/editor/client";
import { AI_PROVIDERS } from "@/lib/ai/store";
import { parseFilterAiResponse } from "./parse";
import { filterAiRequest } from "./prompt";
import type { FilterAiContext, FilterAiProposal } from "./types";

export type FilterAiAvailability = { ok: true; label: string } | { ok: false; reason: string };

export function filterAiAvailability(): FilterAiAvailability {
  try {
    const profile = editorAiProfile();
    const name =
      AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.name ?? profile.provider;
    return editorAiSupported(profile)
      ? { ok: true, label: profile.model ? `${name} · ${profile.model}` : name }
      : {
          ok: false,
          reason: `${name} kann keine Filter erzeugen. Claude Code, Codex oder einen API- bzw. lokalen Anbieter wählen.`,
        };
  } catch {
    return { ok: false, reason: "Noch kein KI-Anbieter eingerichtet." };
  }
}

export async function runFilterAi(
  context: FilterAiContext,
  prompt: string,
  signal?: AbortSignal,
): Promise<FilterAiProposal> {
  const response = await runEditorAi({
    action: "filter",
    ...filterAiRequest(context, prompt),
    signal,
  });
  try {
    return parseFilterAiResponse(response.text, context);
  } catch (error) {
    if (response.truncated)
      throw new Error("Die KI-Antwort wurde abgeschnitten. Bitte die Anfrage kürzer fassen.");
    throw error;
  }
}
