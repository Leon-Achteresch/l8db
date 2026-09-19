import { cn } from "@/lib/utils";

export function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("font-heading text-lg font-medium tracking-tight", className)}
      {...props}
    />
  );
}
