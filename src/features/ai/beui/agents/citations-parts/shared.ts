import type { ReactNode } from "react";
export interface CitationItem {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
}
export interface CitationsProps {
  citations: CitationItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  idPrefix?: string;
  className?: string;
}
export interface CitationProps {
  citationId: string;
  index: number;
  idPrefix: string;
  className?: string;
}
export interface CitationListProps {
  citations: CitationItem[];
  idPrefix?: string;
  className?: string;
}
export interface CitationStackProps {
  citations: CitationItem[];
  limit?: number;
  className?: string;
}
export function citationTargetId(prefix: string, citationId: string) {
  return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
