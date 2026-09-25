import { EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveConnection } from "@/lib/connections";
import { useMaskingDisplay } from "@/lib/masking-display";
import { cn } from "@/lib/utils";

export function MaskingToggle() {
  const connection = useActiveConnection();
  const enabled = useMaskingDisplay((state) =>
    connection ? Boolean(state.enabled[connection.id]) : false,
  );
  const toggle = useMaskingDisplay((state) => state.toggle);
  if (!connection) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-7", enabled && "bg-amber-500/15 text-amber-700 dark:text-amber-400")}
          aria-label="Maskierung anzeigen"
          aria-pressed={enabled}
          onClick={() => toggle(connection.id)}
        >
          <EyeOffIcon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {enabled ? "Maskierung aktiv – Bearbeiten gesperrt" : "Maskierung anzeigen"}
      </TooltipContent>
    </Tooltip>
  );
}
