import { Workflow } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Switch } from "@/components/ui/switch";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface McpWorkflowsSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function McpWorkflowsSection({ enabled, onToggle }: McpWorkflowsSectionProps) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLElement>("mcp.workflows");

  return (
    <section ref={ref} className="space-y-4">
      <div className="flex items-center gap-2">
        <Workflow className="size-5 text-primary" />
        <h2 className="text-base font-semibold tracking-tight text-foreground">Workflows</h2>
        {isNew ? <NewBadge /> : null}
      </div>
      <div className="flex items-center justify-between gap-6 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">KI-Clients dürfen Workflows steuern</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Workflows anlegen, ändern, löschen und ausführen. Workflow-Schritte laufen mit den
            Rechten der Automatisierung: Masken, Read-only-Freigaben und Produktionssperren des MCP
            gelten dort nicht, und Shell-Schritte führen Befehle auf diesem Rechner aus.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label="KI-Clients dürfen Workflows steuern"
        />
      </div>
    </section>
  );
}
