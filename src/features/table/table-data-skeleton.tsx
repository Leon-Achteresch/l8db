import { Skeleton } from "@/components/ui/skeleton";

export function TableDataSkeleton() {
  return (
    <div className="flex-1 overflow-hidden border-t border-border bg-background p-4 space-y-3 select-none">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 bg-muted/50" />
        <Skeleton className="h-8 w-32 bg-muted/50" />
        <Skeleton className="h-8 w-20 bg-muted/50" />
        <Skeleton className="h-8 w-40 bg-muted/50" />
      </div>
      <div className="space-y-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <Skeleton className="h-5 w-8 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
          </div>
        ))}
      </div>
    </div>
  );
}
