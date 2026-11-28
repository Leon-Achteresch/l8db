import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AiPartsLabSpecimen({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className={cn("min-w-0 space-y-1.5", wide && "col-span-full")}>
      <figcaption className="px-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </figcaption>
      <div className="rounded-xl bg-background p-4 shadow-[0_1px_2px_oklch(0_0_0/6%)]">
        {children}
      </div>
    </figure>
  );
}
