import {
  BoxIcon,
  BracesIcon,
  EyeIcon,
  LayersIcon,
  Link2Icon,
  PackageIcon,
  SquareFunctionIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof BoxIcon> = {
  PACKAGE: PackageIcon,
  "PACKAGE BODY": PackageIcon,
  VIEW: EyeIcon,
  "MATERIALIZED VIEW": LayersIcon,
  TRIGGER: ZapIcon,
  FUNCTION: SquareFunctionIcon,
  PROCEDURE: WorkflowIcon,
  TYPE: BracesIcon,
  "TYPE BODY": BracesIcon,
  SYNONYM: Link2Icon,
};

export function InvalidTypeIcon({
  objectType,
  className,
}: {
  objectType: string;
  className?: string;
}) {
  const Icon = ICONS[objectType.toUpperCase()] ?? BoxIcon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
