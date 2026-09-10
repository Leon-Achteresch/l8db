import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  clampPackageOutlineWidth,
  PACKAGE_OUTLINE_MAX_WIDTH,
  PACKAGE_OUTLINE_MIN_WIDTH,
} from "@/lib/package-view-prefs";
import type { PlsqlMember } from "@/lib/plsql";
import { cn } from "@/lib/utils";

export function PackageMemberOutline({
  members,
  activeName,
  width,
  onWidthChange,
  onSelect,
}: {
  members: PlsqlMember[];
  activeName?: string;
  width: number;
  onWidthChange: (width: number) => void;
  onSelect: (member: PlsqlMember) => void;
}) {
  const [query, setQuery] = useState("");
  const [draftWidth, setDraftWidth] = useState(width);
  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) return members;
    return members.filter((m) => m.name.includes(needle));
  }, [members, query]);

  useEffect(() => {
    setDraftWidth(width);
  }, [width]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = draftWidth;
    let nextWidth = startWidth;
    let frame = 0;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampPackageOutlineWidth(startWidth + (moveEvent.clientX - startX));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDraftWidth(nextWidth);
      });
    };

    const handlePointerUp = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      setDraftWidth(nextWidth);
      onWidthChange(nextWidth);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <aside
      style={{ width: draftWidth }}
      className="relative flex min-w-0 shrink-0 flex-col overflow-hidden border-r bg-muted/20"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b px-2.5 py-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Mitglieder
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{members.length}</span>
      </div>
      {members.length > 8 ? (
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtern…"
            className="h-7 rounded-md px-2 text-xs"
          />
        </div>
      ) : null}
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-0.5 p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Keine Treffer.</p>
          ) : (
            filtered.map((member) => {
              const active = member.name === activeName;
              return (
                <button
                  key={`${member.kind}:${member.name}`}
                  type="button"
                  onClick={() => onSelect(member)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 py-1 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {member.kind === "FUNCTION" ? "fn" : "pr"}
                  </span>
                  <span className="min-w-0 truncate font-mono text-xs">{member.name}</span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={draftWidth}
        aria-valuemin={PACKAGE_OUTLINE_MIN_WIDTH}
        aria-valuemax={PACKAGE_OUTLINE_MAX_WIDTH}
        onPointerDown={handlePointerDown}
        className="absolute inset-y-0 right-0 z-20 w-3 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:opacity-0 after:transition-opacity hover:after:opacity-100"
      />
    </aside>
  );
}
