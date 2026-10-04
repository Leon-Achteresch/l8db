import { Handle, Position } from "@xyflow/react";
import { handlesFor } from "@/lib/automation/step-graph";
import type { Step } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

const BASE =
  "!size-2 !min-h-0 !min-w-0 !border-[1.5px] !border-card transition-[opacity,scale] duration-150 opacity-0 before:absolute before:-inset-2 before:content-[''] group-hover/node:opacity-100 group-focus-within/node:opacity-100 group-data-[selected=true]/node:opacity-100";

const POSITION = {
  success: {
    position: Position.Bottom,
    style: undefined,
    title: "Bei Erfolg – ziehen für „Gehe zu“",
  },
  failure: {
    position: Position.Right,
    style: undefined,
    title: "Bei Fehler – ziehen für „Gehe zu“",
  },
  yes: { position: Position.Bottom, style: { left: "32%" }, title: "Ja – ziehen für „Gehe zu“" },
  no: { position: Position.Bottom, style: { left: "68%" }, title: "Nein – ziehen für „Gehe zu“" },
} as const;

interface Props {
  step: Step;
}

export function StepGraphHandles({ step }: Props) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectableStart={false}
        className={cn(BASE, "!bg-muted-foreground/50")}
      />
      {handlesFor(step).map((handle) => {
        const { position, style, title } = POSITION[handle];
        return (
          <Handle
            key={handle}
            id={handle}
            type="source"
            position={position}
            style={style}
            title={title}
            className={cn(
              BASE,
              "!size-2.5 hover:!scale-125",
              handle === "failure" ? "!bg-destructive" : "!bg-muted-foreground",
            )}
          />
        );
      })}
    </>
  );
}
