import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import type { CompileErrorInfo } from "@/lib/db";
import { parseCompileMessage } from "@/lib/invalid-objects";

export function InvalidMessageRow({
  message,
  source,
}: {
  message: CompileErrorInfo;
  source?: string;
}) {
  const parsed = parseCompileMessage(message.message);
  const warning = parsed.code?.startsWith("PLW") ?? false;
  const Icon = warning ? TriangleAlertIcon : CircleXIcon;
  return (
    <li className="flex h-6 items-center gap-2 pr-3 pl-[3.25rem] hover:bg-muted/60">
      <Icon
        aria-label={warning ? "Warnung" : "Fehler"}
        className={
          warning ? "size-3.5 shrink-0 text-amber-500" : "size-3.5 shrink-0 text-destructive"
        }
      />
      {source && <span className="shrink-0 text-muted-foreground">{source}</span>}
      <span className="min-w-0 flex-1 truncate select-text" title={message.message}>
        {parsed.text}
      </span>
      {parsed.code && (
        <span className="shrink-0 text-muted-foreground select-text">{parsed.code}</span>
      )}
      <span className="w-20 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums">
        {message.line ? `[${message.line}, ${message.position ?? 0}]` : ""}
      </span>
    </li>
  );
}
