import {
  CogIcon,
  EyeIcon,
  FileIcon,
  LayersIcon,
  ListOrderedIcon,
  type LucideIcon,
  PackageIcon,
  SproutIcon,
  SquareFunctionIcon,
  Table2Icon,
  TagIcon,
  TicketIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ObjectCategory } from "@/lib/versioning/review";

export const CATEGORY_ICONS: Record<ObjectCategory, LucideIcon> = {
  table: Table2Icon,
  view: EyeIcon,
  materialized_view: LayersIcon,
  routine: SquareFunctionIcon,
  procedure: WorkflowIcon,
  package: PackageIcon,
  sequence: ListOrderedIcon,
  release: TagIcon,
  customers: UsersIcon,
  seeds: SproutIcon,
  tickets: TicketIcon,
  project: CogIcon,
  other: FileIcon,
};

export const STATUS_TONES: Record<string, { label: string; tone: string }> = {
  A: { label: "neu", tone: "text-emerald-600 dark:text-emerald-400" },
  M: { label: "geändert", tone: "text-amber-600 dark:text-amber-400" },
  D: { label: "entfernt", tone: "text-destructive" },
  T: { label: "Typ geändert", tone: "text-amber-600 dark:text-amber-400" },
};
