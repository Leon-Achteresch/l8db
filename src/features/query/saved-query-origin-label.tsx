import type { SavedQueryOriginInfo } from "@/lib/saved-query-origin";

export function SavedQueryOriginLabel({ info }: { info: SavedQueryOriginInfo }) {
  return (
    <span
      className="min-w-0 max-w-1/2 truncate text-[10px] font-normal text-muted-foreground"
      title={info.title}
    >
      {info.label}
    </span>
  );
}
