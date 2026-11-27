import { aiEnabled } from "@/lib/ai/access";
import { editorAiProfile, editorAiSupported, runEditorAi } from "@/lib/ai/editor/client";
import type { AppTheme } from "@/lib/app-themes";
import { parseThemeFile, THEME_FORMAT_GUIDE } from "@/lib/theme-file";

export const THEME_AI_MAX_PROMPT = 1_000;

export function themeAiAvailable(): boolean {
  try {
    return aiEnabled() && editorAiSupported(editorAiProfile());
  } catch {
    return false;
  }
}

export async function runThemeAi(description: string, signal?: AbortSignal): Promise<AppTheme> {
  const response = await runEditorAi({
    action: "theme",
    cached: THEME_FORMAT_GUIDE,
    system:
      "Du gestaltest Farb-Themes für die Desktop-App l8db. Gib alle Farben in colors für beide Modi an und achte auf guten Kontrast. Antworte ausschließlich mit dem JSON-Objekt.",
    messages: [{ role: "user", text: description.slice(0, THEME_AI_MAX_PROMPT) }],
    maxTokens: 3_000,
    signal,
  });
  try {
    return parseThemeFile(response.text);
  } catch (error) {
    if (response.truncated) throw new Error("Die KI-Antwort wurde abgeschnitten.");
    throw error;
  }
}
