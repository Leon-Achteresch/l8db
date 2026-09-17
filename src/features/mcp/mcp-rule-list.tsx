import { Plus, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { McpRuleItem } from "@/features/mcp/mcp-rule-item";
import type { RedactRule } from "@/lib/mcp";

interface McpRuleListProps {
  title: string;
  description: string;
  rules: RedactRule[];
  onChange: (rules: RedactRule[]) => void;
}

export function McpRuleList({ title, description, rules, onChange }: McpRuleListProps) {
  const activeCount = rules.filter((r) => r.enabled).length;

  const setRule = (index: number, patch: Partial<RedactRule>) => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  const addRule = () => {
    onChange([...rules, { name: "Neue Regel", pattern: "", enabled: true }]);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border/80 bg-card/60 p-4 shadow-2xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <Badge variant="secondary" className="text-[10px]">
              {activeCount} von {rules.length} aktiv
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>

        <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={addRule}>
          <Plus className="size-3.5" />
          Regel hinzufügen
        </Button>
      </div>

      <div className="space-y-2">
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
            Keine Regeln hinterlegt. Klicke auf „Regel hinzufügen“.
          </p>
        ) : (
          rules.map((rule, index) => {
            const occurrence = rules.slice(0, index).filter((r) => r.name === rule.name).length;
            return (
              <McpRuleItem
                key={`${rule.name}:${rule.pattern}:${occurrence}`}
                rule={rule}
                onUpdate={(patch) => setRule(index, patch)}
                onRemove={() => removeRule(index)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
