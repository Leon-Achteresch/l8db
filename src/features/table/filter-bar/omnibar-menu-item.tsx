import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export function OmnibarMenuItem({
  id,
  active,
  icon,
  label,
  detail,
  shortcut,
  children,
  onSelect,
  onHover,
}: {
  id: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  detail?: string;
  shortcut?: string;
  children?: ReactNode;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
      className={cn(
        "flex min-h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm outline-none",
        active ? "bg-accent text-accent-foreground" : "text-foreground",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="shrink-0">{label}</span>
      {detail ? (
        <span
          title={detail}
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {detail}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {children}
      {shortcut ? <Kbd className="shrink-0">{shortcut}</Kbd> : null}
    </div>
  );
}
