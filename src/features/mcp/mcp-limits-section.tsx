import { AlignLeft, Clock, FileText, SlidersHorizontal, Table } from "lucide-react";
import { McpLimitField } from "@/features/mcp/mcp-limit-field";
import type { McpConfig } from "@/lib/mcp";

interface McpLimitsSectionProps {
  config: McpConfig;
  onUpdateConfig: (patch: (current: McpConfig) => McpConfig) => void;
}

export function McpLimitsSection({ config, onUpdateConfig }: McpLimitsSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Antwort-Limits & Ressourcen
          </h2>
          <p className="text-xs text-muted-foreground">
            Gedrosselte Antworten sparen LLM-Tokens, verhindern Puffer-Überläufe und schützen
            Datenbanken vor Endlosabfragen.
          </p>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <McpLimitField
          label="Zeilen pro Abfrage"
          description="Maximale Zeilenanzahl pro SELECT-Ergebnis"
          value={config.maxRows}
          unit="Zeilen"
          min={1}
          max={1000}
          icon={Table}
          onChange={(maxRows) => onUpdateConfig((current) => ({ ...current, maxRows }))}
        />

        <McpLimitField
          label="Zeichen pro Zelle"
          description="Lange Texte werden nach diesem Limit abgeschnitten"
          value={config.maxCellChars}
          unit="Zeichen"
          min={10}
          max={10000}
          icon={AlignLeft}
          onChange={(maxCellChars) => onUpdateConfig((current) => ({ ...current, maxCellChars }))}
        />

        <McpLimitField
          label="Zeichen pro Antwort"
          description="Maximale Gesamtlänge der JSON-Antwort an das KI-Tool"
          value={config.maxChars}
          unit="Zeichen"
          min={500}
          max={200000}
          icon={FileText}
          onChange={(maxChars) => onUpdateConfig((current) => ({ ...current, maxChars }))}
        />

        <McpLimitField
          label="Abfrage-Timeout"
          description="Maximale Ausführungsdauer einer Datenbankabfrage"
          value={config.queryTimeout}
          unit="Sek."
          min={5}
          max={300}
          icon={Clock}
          onChange={(queryTimeout) => onUpdateConfig((current) => ({ ...current, queryTimeout }))}
        />
      </div>
    </section>
  );
}
