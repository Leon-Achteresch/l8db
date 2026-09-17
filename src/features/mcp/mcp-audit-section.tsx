import { History, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { McpAuditRow } from "@/features/mcp/mcp-audit-row";
import { McpEmptyState } from "@/features/mcp/mcp-empty-state";
import { clearMcpAudit, type McpAuditEntry } from "@/lib/mcp";

interface McpAuditSectionProps {
  audit: McpAuditEntry[];
  onRefresh: () => void;
}

export function McpAuditSection({ audit, onRefresh }: McpAuditSectionProps) {
  const [query, setQuery] = useState("");
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return audit;
    const q = query.toLowerCase();
    return audit.filter(
      (entry) =>
        entry.connection.toLowerCase().includes(q) ||
        entry.tool.toLowerCase().includes(q) ||
        entry.sql.toLowerCase().includes(q),
    );
  }, [audit, query]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearMcpAudit();
      onRefresh();
      toast.success("Audit-Protokoll wurde geleert.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Audit-Protokoll
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Historie aller Abfragen und Tool-Aufrufe, die über den MCP-Server ausgeführt wurden.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Protokoll durchsuchen…"
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={onRefresh}
            title="Protokoll neu laden"
          >
            <RefreshCw className="size-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            disabled={clearing || audit.length === 0}
            title="Protokoll leeren"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-2xs">
        {audit.length === 0 ? (
          <div className="p-4">
            <McpEmptyState
              icon={History}
              title="Noch keine Aufrufe protokolliert"
              description="Sobald ein KI-Tool Abfragen über den MCP-Server ausführt, erscheinen sie hier."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <McpEmptyState
              icon={Search}
              title="Keine Einträge für diesen Suchbegriff"
              description="Versuche einen anderen Suchbegriff oder setze die Suche zurück."
              action={
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  Suche zurücksetzen
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-3.5 py-2">Zeitpunkt</th>
                  <th className="px-3.5 py-2">Verbindung</th>
                  <th className="px-3.5 py-2">Tool</th>
                  <th className="px-3.5 py-2">SQL-Befehl</th>
                  <th className="px-3.5 py-2 text-right">Dauer</th>
                  <th className="px-3.5 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <McpAuditRow
                    key={`${entry.ts}-${entry.connection}-${entry.tool}-${entry.sql.slice(0, 16)}`}
                    entry={entry}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
