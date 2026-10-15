import { TicketIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { openForgeUrl } from "@/lib/versioning/forge";
import type { TicketReference } from "@/lib/versioning/review";

export function VersioningTicketChips({
  tickets,
  className,
  linked = true,
}: {
  tickets: TicketReference[];
  className?: string;
  linked?: boolean;
}) {
  if (!tickets.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tickets.map((ticket) => {
        const content = (
          <>
            <TicketIcon className="size-3" strokeWidth={1.7} />
            {ticket.key}
          </>
        );
        const style =
          "inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-700 dark:text-sky-300";
        return linked && ticket.url ? (
          <button
            key={ticket.key}
            type="button"
            title={`${ticket.tracker}: ${ticket.key} öffnen`}
            onClick={(event) => {
              event.stopPropagation();
              void openForgeUrl(ticket.url ?? "");
            }}
            className={cn(style, "hover:bg-sky-500/20")}
          >
            {content}
          </button>
        ) : (
          <span key={ticket.key} title={ticket.tracker} className={style}>
            {content}
          </span>
        );
      })}
    </span>
  );
}
