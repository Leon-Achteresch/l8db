import type { Ref } from "react";
import { NewBadge } from "@/components/new-badge";

export interface ColumnUpdateFeature {
  ref: Ref<HTMLSpanElement>;
  isNew: boolean;
}

export function ColumnUpdateRule({
  expression,
  feature,
}: {
  expression: string;
  feature?: ColumnUpdateFeature;
}) {
  return (
    <span
      ref={feature?.ref}
      className="flex min-w-0 flex-col text-2xs leading-tight text-muted-foreground"
      title={`ON UPDATE ${expression}`}
      data-column-on-update
    >
      <span className="flex items-center gap-1 text-2xs">
        ON UPDATE{feature?.isNew && <NewBadge />}
      </span>
      <code className="truncate text-foreground/85">{expression}</code>
    </span>
  );
}
