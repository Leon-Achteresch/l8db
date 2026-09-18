import { RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { McpRedactionTester } from "@/features/mcp/mcp-redaction-tester";
import { McpRuleList } from "@/features/mcp/mcp-rule-list";
import { defaultRedaction, type McpConfig, type RedactRule } from "@/lib/mcp";

interface McpRedactionSectionProps {
  config: McpConfig;
  onUpdateConfig: (patch: (current: McpConfig) => McpConfig) => void;
}

export function McpRedactionSection({ config, onUpdateConfig }: McpRedactionSectionProps) {
  const resetToDefault = async () => {
    try {
      const standard = await defaultRedaction();
      onUpdateConfig((current) => ({ ...current, redaction: standard }));
      toast.success("Standard-Maskierungsregeln wiederhergestellt.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const updateColumns = (columns: RedactRule[]) => {
    onUpdateConfig((current) => ({
      ...current,
      redaction: { ...current.redaction, columns },
    }));
  };

  const updateValues = (values: RedactRule[]) => {
    onUpdateConfig((current) => ({
      ...current,
      redaction: { ...current.redaction, values },
    }));
  };

  const updateReplacement = (replacement: string) => {
    onUpdateConfig((current) => ({
      ...current,
      redaction: { ...current.redaction, replacement },
    }));
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Datenschutz & Maskierung
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Schütze sensible Kundendaten und Zugangsdaten vor der Übertragung an KI-Modelle. Treffer
            werden automatisch durch den Ersatztext ersetzt.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetToDefault}>
            <RotateCcw className="size-3.5" />
            Standard-Regeln laden
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/60 p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <label htmlFor="mcp-replacement-val" className="text-sm font-semibold text-foreground">
            Ersatztext (Placeholder)
          </label>
          <p className="text-xs text-muted-foreground">
            Dieser Text wird anstelle der maskierten Werte oder Spalten an das KI-Tool gesendet.
          </p>
        </div>

        <Input
          id="mcp-replacement-val"
          className="h-8 w-full font-mono text-xs bg-background sm:w-48"
          value={config.redaction.replacement}
          onChange={(e) => updateReplacement(e.target.value)}
          placeholder="[GESCHWÄRZT]"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <McpRuleList
          title="Spaltenregeln (Column Masking)"
          description="Maskiert gesamte Spalten anhand ihres Namens (z. B. passwort, secret, kreditkarte). Groß-/Kleinschreibung wird ignoriert."
          rules={config.redaction.columns}
          onChange={updateColumns}
        />

        <McpRuleList
          title="Wertregeln (Value Pattern Masking)"
          description="Erkennt und maskiert Muster wie E-Mails, Telefonnummern, IBANs oder Tokens innerhalb von Tabellenzellen."
          rules={config.redaction.values}
          onChange={updateValues}
        />
      </div>

      <McpRedactionTester config={config} />
    </section>
  );
}
