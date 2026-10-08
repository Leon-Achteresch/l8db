import {
  BoxesIcon,
  CogIcon,
  Columns3Icon,
  EyeIcon,
  HashIcon,
  KeyRoundIcon,
  LayersIcon,
  Link2Icon,
  ListTreeIcon,
  MessageSquareIcon,
  PackageIcon,
  PackageOpenIcon,
  ShapesIcon,
  ShieldCheckIcon,
  SquareFunctionIcon,
  Table2Icon,
  ZapIcon,
} from "lucide-react";
import type { CatalogObjectType } from "@/lib/db";
import { cn } from "@/lib/utils";

const VISUAL: Record<CatalogObjectType, { Icon: typeof Table2Icon; color: string }> = {
  table: { Icon: Table2Icon, color: "text-muted-foreground" },
  column: { Icon: Columns3Icon, color: "text-muted-foreground" },
  constraint: { Icon: KeyRoundIcon, color: "text-muted-foreground" },
  index: { Icon: ListTreeIcon, color: "text-muted-foreground" },
  trigger: { Icon: ZapIcon, color: "text-muted-foreground" },
  view: { Icon: EyeIcon, color: "text-muted-foreground" },
  materialized_view: { Icon: LayersIcon, color: "text-muted-foreground" },
  sequence: { Icon: HashIcon, color: "text-muted-foreground" },
  function: { Icon: SquareFunctionIcon, color: "text-muted-foreground" },
  procedure: { Icon: CogIcon, color: "text-muted-foreground" },
  package: { Icon: PackageIcon, color: "text-muted-foreground" },
  package_body: { Icon: PackageOpenIcon, color: "text-muted-foreground" },
  type: { Icon: ShapesIcon, color: "text-muted-foreground" },
  type_body: { Icon: BoxesIcon, color: "text-muted-foreground" },
  synonym: { Icon: Link2Icon, color: "text-muted-foreground" },
  comment: { Icon: MessageSquareIcon, color: "text-muted-foreground" },
  grant: { Icon: ShieldCheckIcon, color: "text-muted-foreground" },
};

export function SchemaObjectIcon({
  type,
  className,
}: {
  type: CatalogObjectType;
  className?: string;
}) {
  const { Icon, color } = VISUAL[type];
  return <Icon className={cn("size-3.5 shrink-0", color, className)} />;
}
