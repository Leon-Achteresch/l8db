import {
  BracesIcon,
  EyeIcon,
  LayersIcon,
  ListOrderedIcon,
  PackageIcon,
  PlayIcon,
  TableIcon,
} from "lucide-react";

import type { CompareObjectType } from "@/lib/compare-types";
import { cn } from "@/lib/utils";

const VISUAL: Record<
  CompareObjectType,
  { Icon: typeof TableIcon; className: string }
> = {
  table: { Icon: TableIcon, className: "text-emerald-500" },
  view: { Icon: EyeIcon, className: "text-cyan-500" },
  materialized_view: { Icon: LayersIcon, className: "text-teal-500" },
  routine: { Icon: BracesIcon, className: "text-violet-500" },
  procedure: { Icon: PlayIcon, className: "text-fuchsia-500" },
  package: { Icon: PackageIcon, className: "text-amber-500" },
  sequence: { Icon: ListOrderedIcon, className: "text-orange-500" },
};

interface CompareObjectIconProps {
  type: CompareObjectType;
  className?: string;
}

export function CompareObjectIcon({ type, className }: CompareObjectIconProps) {
  const { Icon, className: color } = VISUAL[type];
  return <Icon className={cn("size-3.5 shrink-0", color, className)} />;
}
