import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { RedactRule } from "@/lib/mcp";

interface McpRuleItemProps {
  rule: RedactRule;
  onUpdate: (patch: Partial<RedactRule>) => void;
  onRemove: () => void;
}

export function McpRuleItem({ rule, onUpdate, onRemove }: McpRuleItemProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/50 p-2 transition-colors hover:border-border">
      <Checkbox
        checked={rule.enabled}
        onCheckedChange={(checked) => onUpdate({ enabled: checked === true })}
        aria-label={`${rule.name} aktiv`}
      />
      <Input
        className="h-8 w-44 shrink-0 text-xs bg-background"
        value={rule.name}
        placeholder="Regelname"
        onChange={(event) => onUpdate({ name: event.target.value })}
        aria-label="Regelname"
      />
      <Input
        className="h-8 flex-1 font-mono text-[11px] bg-background"
        value={rule.pattern}
        placeholder="Regex-Muster (z. B. credit_card|iban)"
        onChange={(event) => onUpdate({ pattern: event.target.value })}
        aria-label="Regex-Muster"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`${rule.name} löschen`}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
