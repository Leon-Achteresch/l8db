import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorCheckpoints } from "@/lib/ai/editor/checkpoints";
import { editorAiController } from "@/lib/ai/editor/controller";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const EMPTY: never[] = [];

export function EditorAiCheckpoints({ editorId }: { editorId: string }) {
  const checkpoints = useEditorCheckpoints((state) => state.byEditor[editorId] ?? EMPTY);
  const feature = useNewFeatureVisibility<HTMLButtonElement>(
    checkpoints.length ? "workspace.status.ai-checkpoints" : undefined,
  );
  if (!checkpoints.length) return null;
  const restore = (id: string, label: string) => {
    if (editorAiController(editorId)?.restoreCheckpoint(id))
      toast.success(`Stand vor „${label}“ wiederhergestellt`, {
        description: "Mit ⌘Z lässt sich das Zurücksetzen rückgängig machen.",
      });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={feature.ref}
          type="button"
          title="Stände vor KI-Änderungen"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground"
        >
          <History className="size-3" aria-hidden />
          KI-Verlauf ({checkpoints.length}){feature.isNew && <NewBadge />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">Zurück zum Stand vor …</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[...checkpoints].reverse().map((checkpoint) => (
          <DropdownMenuItem
            key={checkpoint.id}
            className="gap-2 text-xs"
            onSelect={() => restore(checkpoint.id, checkpoint.label)}
          >
            <RotateCcw className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{checkpoint.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {new Date(checkpoint.at).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
