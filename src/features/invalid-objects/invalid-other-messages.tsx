import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import type { CompileErrorInfo } from "@/lib/db";
import { INVALID_RENDER_STEP } from "@/lib/invalid-objects";
import { cn } from "@/lib/utils";
import { InvalidMessageRow } from "./invalid-message-row";

export function InvalidOtherMessages({
  messages,
  open,
  onToggle,
}: {
  messages: CompileErrorInfo[];
  open: boolean;
  onToggle: () => void;
}) {
  const shown = messages.slice(0, INVALID_RENDER_STEP);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 pl-2 text-left hover:bg-muted/60"
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" />
        <span className="truncate font-sans font-medium">Weitere Meldungen</span>
        <span className="shrink-0 font-sans text-[11px] text-muted-foreground">
          ohne invalides Objekt
        </span>
        <span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 font-sans text-[10px] text-muted-foreground tabular-nums">
          {messages.length}
          <span className="sr-only"> Meldungen</span>
        </span>
      </button>
      {open && (
        <ul>
          {shown.map((message, index) => (
            <InvalidMessageRow
              key={`${message.schema}.${message.name}.${message.object_type}.${index}`}
              message={message}
              source={`${message.schema}.${message.name}`}
            />
          ))}
          {messages.length > shown.length && (
            <li className="h-6 pl-[3.25rem] font-sans text-[11px] leading-6 text-muted-foreground">
              +{messages.length - shown.length} weitere Meldungen
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
