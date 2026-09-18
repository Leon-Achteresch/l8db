import { CheckCircleIcon, XCircleIcon } from "lucide-react";

export function FeedbackPanel({
  state,
}: {
  state: { status: "success"; time?: number } | { status: "error"; message: string };
}) {
  return (
    <div
      className={
        state.status === "success"
          ? "flex items-start gap-2 border-t bg-emerald-500/5 px-4 py-2.5"
          : "flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5"
      }
    >
      {state.status === "success" ? (
        <>
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Erfolgreich
            {state.time != null ? ` (${state.time} ms)` : ""}
          </span>
        </>
      ) : (
        <>
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <pre className="flex-1 whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {state.message}
          </pre>
        </>
      )}
    </div>
  );
}
