import { XIcon } from "lucide-react";
import type { CSSProperties, KeyboardEvent, Ref } from "react";
import { cn } from "@/lib/utils";

export type FilterTokenPart = "column" | "operator" | "value";

interface FilterTokenProps {
  ref?: Ref<HTMLDivElement>;
  kind: "condition" | "rule";
  variant: "chip" | "pill";
  column: string;
  operator?: string;
  value?: string;
  color?: string;
  title: string;
  removeLabel: string;
  onOpen: (part: FilterTokenPart) => void;
  onRemove: () => void;
}

export function FilterToken({
  ref,
  kind,
  variant,
  column,
  operator,
  value,
  color,
  title,
  removeLabel,
  onOpen,
  onRemove,
}: FilterTokenProps) {
  const style: CSSProperties | undefined = color
    ? {
        backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 50%, transparent)`,
      }
    : undefined;
  const segment =
    "flex h-full min-w-0 items-center gap-1.5 px-2 outline-none transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/10";
  const removeOnKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    event.preventDefault();
    onRemove();
  };
  const divider = color ? "border-l border-current/15" : "border-l border-border/70";
  const parts =
    variant === "pill"
      ? ([
          ["column", column, ""],
          ["operator", operator, "text-muted-foreground"],
          ["value", value, "max-w-52 font-mono text-[11.5px]"],
        ] as const)
      : ([
          [
            "value",
            [column, operator, value].filter(Boolean).join(" "),
            "max-w-80 font-mono text-[11.5px]",
          ],
        ] as const);
  return (
    <div
      ref={ref}
      data-filter-token={kind}
      title={title}
      style={style}
      className={cn(
        "group/token inline-flex h-6 max-w-full shrink-0 items-stretch overflow-hidden rounded-md border text-xs",
        color
          ? ""
          : variant === "pill"
            ? "border-input bg-background/60"
            : "border-transparent bg-muted",
      )}
    >
      {parts.map(([part, text, className], index) =>
        text ? (
          <button
            key={part}
            type="button"
            onClick={() => onOpen(part)}
            onKeyDown={removeOnKey}
            className={cn(segment, index > 0 && divider, className)}
          >
            {index === 0 && color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
            ) : null}
            <span className="truncate">{text}</span>
          </button>
        ) : null,
      )}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        onKeyDown={removeOnKey}
        className={cn(
          "flex items-center px-1.5 text-muted-foreground/80 outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground",
          variant === "pill" && divider,
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
