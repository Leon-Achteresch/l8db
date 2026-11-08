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
let pendingScreenshot: { png: string; at: number } | null = null;

export function setPendingIssueScreenshot(png: string | null): void {
  pendingScreenshot = png ? { png, at: Date.now() } : null;
}

function takePendingScreenshot(): string | null {
  const pending = pendingScreenshot;
  pendingScreenshot = null;
  return pending && Date.now() - pending.at < PENDING_SCREENSHOT_MS ? pending.png : null;
}

export async function handleChatIssueRequest(): Promise<{
  diagnostics: string;
  screenshot: string | null;
}> {
  const [diagnostics, screenshot] = await Promise.all([
    collectDiagnosticText().catch(() => ""),
    takePendingScreenshot() ?? captureRedactedScreenshot().catch(() => null),
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
