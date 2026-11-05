import { Power } from "lucide-react";
import { cn } from "@/lib/utils";

interface McpStudioCoreProps {
  enabled: boolean;
  onToggle: () => void;
}

export function McpStudioCore({ enabled, onToggle }: McpStudioCoreProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        aria-label={enabled ? "MCP-Server ausschalten" : "MCP-Server einschalten"}
        className={cn(
          "group relative flex size-28 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:ring-4 focus-visible:ring-ring",
          enabled
            ? "bg-primary text-primary-foreground shadow-xl shadow-primary/25"
            : "bg-muted text-muted-foreground hover:bg-muted/80",
        )}
      >
        {enabled && (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:2.4s]" />
        )}
        <span
          className={cn(
            "absolute -inset-2 rounded-full opacity-0 ring-2 transition-opacity group-hover:opacity-100",
            enabled ? "ring-primary/35" : "ring-foreground/15",
          )}
        />
        <Power className="relative size-9" strokeWidth={2.25} />
      </button>
      <div className="text-center">
        <div className="text-sm font-semibold">{enabled ? "Läuft" : "Aus"}</div>
        <div className="text-[11px] text-muted-foreground">
          {enabled ? "Klicken zum Stoppen" : "Klicken zum Starten"}
        </div>
      </div>
    </div>
  );
}
