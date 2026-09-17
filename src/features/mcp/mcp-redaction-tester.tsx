import { Eye, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type McpConfig, redactPreview } from "@/lib/mcp";

interface McpRedactionTesterProps {
  config: McpConfig;
}

export function McpRedactionTester({ config }: McpRedactionTesterProps) {
  const [column, setColumn] = useState("kunden_notiz");
  const [text, setText] = useState(
    "Kontakt: max.mustermann@example.com, IBAN DE89 3704 0044 0532 0130 00, Tel +49 170 1234567, Passwort: geheim1234!",
  );
  const [result, setResult] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      redactPreview(config, column, text)
        .then(setResult)
        .catch((error) => setResult(String(error)));
    }, 200);
    return () => clearTimeout(timer);
  }, [config, column, text]);

  const hasChanged = result && result !== text;

  return (
    <div className="space-y-4 rounded-2xl border border-border/80 bg-card/60 p-4 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Regeln live testen</h3>
          {hasChanged ? (
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
              Maskierung greift
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Unverändert
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">Echtzeit-Vorschau der Redaktion</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="mcp-test-col">
              Spaltenname zum Testen
            </label>
            <Input
              id="mcp-test-col"
              className="h-8 font-mono text-xs bg-background"
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              placeholder="z. B. email, iban, notizen"
            />
          </div>

          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-muted-foreground block"
              htmlFor="mcp-test-input"
            >
              Test-Eingabetext
            </label>
            <Textarea
              id="mcp-test-input"
              rows={4}
              className="font-mono text-xs bg-background resize-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Text mit sensiblen Daten eingeben…"
            />
          </div>
        </div>

        <div className="space-y-1.5 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Eye className="size-3.5 text-primary" />
              Ergebnis nach Maskierung
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Ersatz: {config.redaction.replacement}
            </span>
          </div>

          <div className="flex-1 min-h-28 rounded-xl border border-border/70 bg-muted/60 p-3 font-mono text-xs text-foreground/90 break-all select-all whitespace-pre-wrap leading-relaxed">
            {result || "Berechne Vorschau…"}
          </div>
        </div>
      </div>
    </div>
  );
}
