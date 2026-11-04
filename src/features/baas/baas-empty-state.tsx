import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export function BaasEmptyState({
  icon: Icon,
  title,
  description,
  children,
  compact,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Empty
      role="status"
      className={cn(compact ? "flex-none gap-3 rounded-xl p-6" : "gap-5 p-10", className)}
    >
      <EmptyHeader className="gap-1.5">
        <EmptyMedia
          className={cn(
            "relative mb-2 rounded-2xl bg-muted text-muted-foreground",
            compact ? "size-9 [&_svg]:size-4" : "size-12 [&_svg]:size-5",
          )}
        >
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>
          {title}
        </EmptyTitle>
        {description && (
          <EmptyDescription className="text-xs leading-relaxed">{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {children && (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">{children}</EmptyContent>
      )}
    </Empty>
  );
}
