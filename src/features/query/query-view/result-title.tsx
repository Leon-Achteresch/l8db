import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useQueryWorkspace } from "@/lib/query-workspace";

export function ResultTitle() {
  const workspace = useQueryWorkspace();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="font-medium text-xs">Ergebnisse</span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuRadioGroup
          value={workspace.layout}
          onValueChange={(value) =>
            workspace.update({ layout: value as "vertical" | "horizontal" })
          }
        >
          <ContextMenuRadioItem value="vertical">Ergebnisse unten anzeigen</ContextMenuRadioItem>
          <ContextMenuRadioItem value="horizontal">Ergebnisse rechts anzeigen</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
