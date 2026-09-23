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
  table: { Icon: Table2Icon, color: "text-emerald-500" },
  column: { Icon: Columns3Icon, color: "text-sky-500" },
  constraint: { Icon: KeyRoundIcon, color: "text-amber-500" },
  index: { Icon: ListTreeIcon, color: "text-indigo-500" },
  trigger: { Icon: ZapIcon, color: "text-yellow-500" },
  view: { Icon: EyeIcon, color: "text-cyan-500" },
  materialized_view: { Icon: LayersIcon, color: "text-teal-500" },
  sequence: { Icon: HashIcon, color: "text-orange-500" },
  function: { Icon: SquareFunctionIcon, color: "text-violet-500" },
  procedure: { Icon: CogIcon, color: "text-fuchsia-500" },
  package: { Icon: PackageIcon, color: "text-amber-600" },
  package_body: { Icon: PackageOpenIcon, color: "text-amber-600" },
  type: { Icon: ShapesIcon, color: "text-lime-500" },
  type_body: { Icon: BoxesIcon, color: "text-lime-600" },
  synonym: { Icon: Link2Icon, color: "text-slate-500" },
  comment: { Icon: MessageSquareIcon, color: "text-blue-400" },
  grant: { Icon: ShieldCheckIcon, color: "text-rose-500" },
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
