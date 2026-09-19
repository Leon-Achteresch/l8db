"use client";

import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fieldVariants } from "./shared";

export function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}
