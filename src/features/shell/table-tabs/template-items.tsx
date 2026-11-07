import { LayoutTemplateIcon } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useConnectionsStore } from "@/lib/connections";
import type { TemplateEntry } from "@/lib/ui-plugins/registry";
import { templateMatches } from "@/lib/ui-plugins/split-templates";

export function TemplateItems({
  templates,
  onOpenTemplate,
}: {
  templates: readonly TemplateEntry[];
  onOpenTemplate: (entry: TemplateEntry) => void;
}) {
  const connection = useConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === state.activeId),
  );
  const matching = templates.filter((entry) => templateMatches(entry.template, connection));
  if (matching.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Vorlagen</DropdownMenuLabel>
      {matching.map((entry) => (
        <DropdownMenuItem
          key={entry.key}
          onSelect={() => onOpenTemplate(entry)}
          title={`${entry.template.name} · ${entry.plugin.name}`}
        >
          <LayoutTemplateIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{entry.template.name}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {entry.template.panes.map((pane) => pane.table).join(" | ")}
            </span>
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}
