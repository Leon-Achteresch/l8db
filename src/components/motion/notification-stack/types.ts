import type { ReactNode } from "react";

export type NotificationStackItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
};

export type NotificationStackClassNames = {
  stack?: string;
  card?: string;
  content?: string;
  title?: string;
  description?: string;
  trailing?: string;
  footer?: string;
  count?: string;
};

export interface NotificationStackProps {
  items: NotificationStackItem[];
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onViewAll?: () => void;
  maxVisible?: number;
  collapsedLabel?: string;
  expandedLabel?: string;
  emptyLabel?: string;
  className?: string;
  classNames?: NotificationStackClassNames;
}
