import { redactErrorMessage } from "./redact";
import type { DiagnosticsError } from "./types";

const errorLog: DiagnosticsError[] = [];

const ERROR_LIMIT = 20;

export function recordDiagnosticError(source: string, message: string): void {
  errorLog.unshift({
    at: new Date().toISOString(),
    source,
    message: redactErrorMessage(message),
  });
  if (errorLog.length > ERROR_LIMIT) errorLog.length = ERROR_LIMIT;
}

export function recentDiagnosticErrors(): DiagnosticsError[] {
  return [...errorLog];
}

export function clearDiagnosticErrors(): void {
  errorLog.length = 0;
}

export function installDiagnosticsErrorCapture(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    recordDiagnosticError("window.error", event.message ?? String(event.error ?? ""));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordDiagnosticError(
      "unhandledrejection",
      reason instanceof Error ? reason.message : String(reason),
    );
  });
}
