import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import type { CompileErrorInfo } from "@/lib/db";
import { parseCompileMessage } from "@/lib/invalid-objects";
import { cn } from "@/lib/utils";

export function InvalidMessageRow({
  message,
  source,
  onOpen,
}: {
  message: CompileErrorInfo;
  source?: string;
  onOpen?: (line?: number) => void;
}) {
  const parsed = parseCompileMessage(message.message);
  const warning = message.severity
    ? message.severity === "WARNING"
    : (parsed.code?.startsWith("PLW") ?? false);
  const Icon = warning ? TriangleAlertIcon : CircleXIcon;
  const jump = onOpen && message.line ? () => onOpen(message.line ?? undefined) : undefined;
  return (
    <li>
      <button
        type="button"
        disabled={!jump}
        onClick={jump}
        title={jump ? `Zu Zeile ${message.line} springen` : undefined}
        className={cn(
          "flex h-6 w-full items-center gap-2 pr-3 pl-[3.25rem] text-left hover:bg-muted/60 disabled:cursor-default",
          jump && "cursor-pointer",
        )}
      >
        <Icon
          aria-label={warning ? "Warnung" : "Fehler"}
          className={
            warning ? "size-3.5 shrink-0 text-warning" : "size-3.5 shrink-0 text-destructive"
          }
        />
        {source && <span className="shrink-0 text-muted-foreground">{source}</span>}
        <span className="min-w-0 flex-1 truncate select-text" title={message.message}>
          {parsed.text}
        </span>
        {parsed.code && (
          <span className="shrink-0 text-muted-foreground select-text">{parsed.code}</span>
        )}
        <span
          className={cn(
            "w-20 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums",
            jump && "underline-offset-2 hover:text-foreground hover:underline",
          )}
        >
          {message.line ? `[${message.line}, ${message.position ?? 0}]` : ""}
        </span>
      </button>
    </li>
  );
}
