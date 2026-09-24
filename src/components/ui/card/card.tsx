import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-6 overflow-hidden rounded-2xl bg-card py-6 text-sm text-card-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28),0_10px_28px_-22px_oklch(0_0_0/0.35)] ring-1 ring-foreground/8 has-[>img:first-child]:pt-0 data-[size=sm]:gap-4 data-[size=sm]:py-4 [&>img:first-child]:rounded-t-2xl [&>img:last-child]:rounded-b-2xl",
        className,
      )}
      {...props}
    />
  );
}
