import type { AgentActivityTrace } from "../types";

import { TraceIcon } from "./trace-icon";

export function TraceRow({ item }: { item: AgentActivityTrace }) {
  return (
    <div className="grid min-h-8 grid-cols-[1rem_auto_minmax(0,1fr)] items-center gap-2.5 rounded-md px-1.5 py-0.5">
      <span aria-hidden="true" className="grid size-4 place-items-center text-muted-foreground/70">
        {item.icon ?? <TraceIcon kind={item.kind} />}
      </span>
      <span className="font-medium text-foreground/90">{item.label}</span>
      {item.detail ? (
        <span className="min-w-0 truncate rounded-lg bg-muted/80 px-2.5 py-1 font-mono text-xs text-muted-foreground/70">
          {item.detail}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
