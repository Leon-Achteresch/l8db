import { collectDiagnosticText } from "@/features/settings/bug-report-dialog";
import { redactErrorMessage } from "@/lib/diagnostics/redact";
import { captureRedactedScreenshot } from "@/lib/issue-screenshot";
import { useQueryHistoryStore } from "@/lib/query-history";

export function withoutValues(message: string): string {
  return message
    .replace(/'(?:[^']|'')*'/g, "'…'")
    .replace(/"[^"\n]*"/g, '"…"')
    .replace(/=\([^)]*\)/g, "=(…)");
}

const PENDING_SCREENSHOT_MS = 10 * 60_000;
let pendingScreenshot: { png: string; at: number; ref: string } | null = null;

export function setPendingIssueScreenshot(png: string | null): string | null {
  pendingScreenshot = png
    ? { png, at: Date.now(), ref: `Screenshot-Ref: ${crypto.randomUUID().slice(0, 8)}` }
    : null;
  return pendingScreenshot?.ref ?? null;
}

function takePendingScreenshot(texts: readonly string[]): string | null {
  const pending = pendingScreenshot;
  pendingScreenshot = null;
  if (!pending || Date.now() - pending.at >= PENDING_SCREENSHOT_MS) return null;
  return texts.some((text) => text.includes(pending.ref)) ? pending.png : null;
}

export async function handleChatIssueRequest(texts: readonly string[] = []): Promise<{
  diagnostics: string;
  screenshot: string | null;
}> {
  const [diagnostics, screenshot] = await Promise.all([
    collectDiagnosticText().catch(() => ""),
    takePendingScreenshot(texts) ?? captureRedactedScreenshot().catch(() => null),
  ]);
  const failed = useQueryHistoryStore
    .getState()
    .entries.filter((entry) => entry.error)
    .slice(0, 3)
    .map((entry) => `- ${redactErrorMessage(entry.error ?? "")}`);
  return {
    diagnostics: withoutValues(
      failed.length
        ? `${diagnostics}\n\nLetzte fehlgeschlagene Abfragen:\n${failed.join("\n")}`
        : diagnostics,
    ),
    screenshot,
  };
}
