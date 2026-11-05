import { ChevronLeft, ChevronRight } from "lucide-react";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiBranchSwitcher({
  siblings = [],
  id,
  disabled,
  onBranch,
}: {
  siblings?: (string | undefined)[];
  id?: string;
  disabled: boolean;
  onBranch: (id: string | undefined) => void;
}) {
  const index = siblings.indexOf(id);
  if (siblings.length < 2 || index < 0) return null;
  return (
    <div className="flex items-center text-[11px] text-muted-foreground tabular-nums">
      <ResponseAction
        label="Vorherige Version"
        disabled={disabled || index === 0}
        onClick={() => onBranch(siblings[index - 1])}
      >
        <ChevronLeft className="size-3.5" />
      </ResponseAction>
      <span title={`Version ${index + 1} von ${siblings.length}`}>
        {index + 1} / {siblings.length}
      </span>
      <ResponseAction
        label="Nächste Version"
        disabled={disabled || index === siblings.length - 1}
        onClick={() => onBranch(siblings[index + 1])}
      >
        <ChevronRight className="size-3.5" />
      </ResponseAction>
    </div>
  );
}
