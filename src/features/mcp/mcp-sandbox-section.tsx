import { FlaskConical } from "lucide-react";
import { useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Switch } from "@/components/ui/switch";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface McpSandboxSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function McpSandboxSection({ enabled, onToggle }: McpSandboxSectionProps) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLElement>("mcp.sandbox");
  const id = useId();

  return (
    <section ref={ref} className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-5 text-primary" />
        <h2 className="text-base font-semibold tracking-tight text-foreground">Sandbox</h2>
        {isNew ? <NewBadge /> : null}
      </div>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center justify-between gap-6 rounded-2xl bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/60"
      >
        <span className="min-w-0 text-sm font-medium text-foreground">
          Ansichten vor dem Öffnen testen
        </span>
        <Switch
          id={id}
          data-feature="mcp.sandbox"
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label="Ansichten vor dem Öffnen testen"
        />
      </label>
    </section>
  );
}
