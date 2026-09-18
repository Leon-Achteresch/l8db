import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { McpAuditEntry } from "@/lib/mcp";

interface McpAuditRowProps {
  entry: McpAuditEntry;
}

export function McpAuditRow({ entry }: McpAuditRowProps) {
  const formattedDate = entry.ts.replace("T", " ").replace(/\.\d+Z$/, "");

  return (
    <tr className="border-b border-border/60 transition-colors hover:bg-muted/40 last:border-0 text-xs">
      <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
        {formattedDate}
      </td>
      <td className="px-3.5 py-2.5">
        <span className="font-semibold text-foreground">{entry.connection}</span>
      </td>
      <td className="px-3.5 py-2.5">
        <Badge variant="outline" className="font-mono text-[10px]">
          {entry.tool}
        </Badge>
      </td>
      <td className="max-w-xs sm:max-w-md truncate px-3.5 py-2.5 font-mono text-[11px] text-foreground/80">
        <span title={entry.sql}>{entry.sql}</span>
      </td>
      <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3 opacity-60" />
          {entry.ms} ms
        </span>
      </td>
      <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
        {entry.ok ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="size-3.5" />
            OK
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-destructive font-medium cursor-help"
            title={entry.error ?? "Fehler bei der Ausführung"}
          >
            <XCircle className="size-3.5" />
            Fehler
          </span>
        )}
      </td>
    </tr>
  );
}
