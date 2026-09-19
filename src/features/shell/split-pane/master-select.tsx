import { CornerDownRightIcon, Link2Icon } from "lucide-react";
import type * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PaneNumber } from "@/features/shell/split-pane/pane-number";
import { masterCandidates } from "@/lib/split-links";
import { usePaneTabs, useSplitView } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";

const NONE = "none";

const stop = (event: React.MouseEvent) => event.stopPropagation();

export function MasterSelect({ index }: { index: number }) {
  const masters = useSplitView((state) => state.masters);
  const setMaster = useSplitView((state) => state.setMaster);
  const paneTabs = usePaneTabs();
  const master = masters[index] ?? null;
  const candidates = masterCandidates(masters, paneTabs, index);
  if (master === null && candidates.length === 0) return null;
  const label = (pane: number) => {
    const tab = paneTabs[pane];
    return tab ? tabLabel(tab) : masters[pane] != null ? "SQL-Abfrage" : "Leer";
  };
  return (
    <Select
      value={master === null ? NONE : String(master)}
      onValueChange={(value) => setMaster(index, value === NONE ? null : Number(value))}
    >
      <SelectTrigger
        size="sm"
        onMouseDown={stop}
        aria-label="Master dieses Bereichs"
        title={
          master === null
            ? "Diesen Bereich als Detail eines anderen Bereichs verknüpfen"
            : `Detail von Bereich ${master + 1} · Master ändern`
        }
        className="h-5 max-w-48 min-w-0 gap-1 border-0 px-1 py-0 text-xs shadow-none dark:bg-transparent dark:hover:bg-foreground/10"
      >
        {master === null ? (
          <Link2Icon className="size-3.5 text-muted-foreground" />
        ) : (
          <span className="flex min-w-0 items-center gap-1 text-primary">
            <CornerDownRightIcon className="size-3" />
            <span className="hidden shrink-0 @xl:inline">Detail von</span>
            <PaneNumber index={master} className="bg-primary/15 text-primary" />
            <span className="truncate">{label(master)}</span>
          </span>
        )}
      </SelectTrigger>
      <SelectContent position="popper" align="start" onMouseDown={stop}>
        <SelectItem value={NONE} className="text-xs">
          Kein Master
        </SelectItem>
        {candidates.map((pane) => (
          <SelectItem key={pane} value={String(pane)} className="text-xs">
            <PaneNumber index={pane} />
            <span className="truncate">{label(pane)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
