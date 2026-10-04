import {
  BracesIcon,
  BracketsIcon,
  CircleSlashIcon,
  HashIcon,
  QuoteIcon,
  ToggleLeftIcon,
} from "lucide-react";
import type { JsonKind } from "@/lib/json-editor";
import { cn } from "@/lib/utils";

export const JSON_KIND_META: Record<
  JsonKind,
  { icon: typeof BracesIcon; label: string; className: string }
> = {
  object: {
    icon: BracesIcon,
    label: "Objekt",
    className: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  },
  array: {
    icon: BracketsIcon,
    label: "Array",
    className: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  },
  string: {
    icon: QuoteIcon,
    label: "Text",
    className: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  },
  number: {
    icon: HashIcon,
    label: "Zahl",
    className: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  },
  boolean: {
    icon: ToggleLeftIcon,
    label: "Boolean",
    className: "bg-amber-500/14 text-amber-600 dark:text-amber-300",
  },
  null: {
    icon: CircleSlashIcon,
    label: "Null",
    className: "bg-muted text-muted-foreground",
  },
};

export function JsonTypeIcon({ kind, className }: { kind: JsonKind; className?: string }) {
  const meta = JSON_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-md",
        meta.className,
        className,
      )}
      title={meta.label}
    >
      <Icon className="size-3" strokeWidth={2.25} />
    </span>
  );
}
