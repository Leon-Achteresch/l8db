"use client";

import { cva } from "class-variance-authority";
import { createContext } from "react";

export const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-[calc(2.25rem+var(--ui-density-step))] group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const TabsStateContext = createContext<{
  baseId: string;
  value: string | undefined;
  orientation: "horizontal" | "vertical";
} | null>(null);

export function tabsTriggerId(baseId: string, value: string) {
  return `${baseId}-trigger-${value}`;
}

export function tabsContentId(baseId: string, value: string) {
  return `${baseId}-content-${value}`;
}
