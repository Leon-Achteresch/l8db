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

export async function handleChatIssueRequest(): Promise<{
  diagnostics: string;
  screenshot: string | null;
}> {
  const [diagnostics, screenshot] = await Promise.all([
    collectDiagnosticText().catch(() => ""),
    captureRedactedScreenshot().catch(() => null),
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
