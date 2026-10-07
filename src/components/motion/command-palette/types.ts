import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { NewFeatureId } from "@/lib/new-features";

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  kind?: "command" | "setting" | "object" | "connection";
  context?: string;
  hint?: string;
  keywords?: string[];
  icon?: LucideIcon;
  badge?: ReactNode;
  onSelect: () => void;
};

export interface CommandPaletteProps {
  items: CommandItem[];
  /** Opens with Cmd/Ctrl + this key. Default: "k" */
  shortcut?: string;
  placeholder?: string;
  emptyMessage?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  maxVisible?: number;
  featureId?: NewFeatureId;
  queryItem?: (query: string) => CommandItem;
  initialQuery?: string;
  commandFeatureId?: NewFeatureId;
  recentCommandIds?: string[];
  onSelectItem?: (item: CommandItem) => void;
}
