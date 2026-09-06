import { Info } from "lucide-react";

import { Tooltip } from "@/components/motion/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  detail: string;
  className?: string;
  iconClassName?: string;
}

export function DriverDetail({ detail, className, iconClassName }: Props) {
  if (detail.length <= 140) {
    return <span className={className}>{detail}</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Tooltip content={detail} side="bottom" className="max-w-md whitespace-normal break-words">
        <span
          role="img"
          aria-label="Treiber-Details anzeigen"
          className="inline-flex cursor-help text-destructive"
        >
          <Info className={iconClassName ?? "size-4"} />
        </span>
      </Tooltip>
    </span>
  );
}
