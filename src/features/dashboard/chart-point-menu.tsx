import { FilterIcon, FilterXIcon, TableIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export interface ChartPoint {
  x: number;
  y: number;
  label: string;
  filtered: boolean;
  canFilter: boolean;
  canDrill: boolean;
}

const ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function ChartPointMenu({
  point,
  onClose,
  onFilter,
  onDetails,
}: {
  point: ChartPoint | null;
  onClose: () => void;
  onFilter: () => void;
  onDetails: () => void;
}) {
  return (
    <Popover open={point !== null} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-0"
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />
      </PopoverAnchor>
      <PopoverContent align="start" className="w-60 gap-0 p-1">
        {point && (
          <>
            <div className="truncate px-2 pt-1 pb-1.5 text-xs font-medium" title={point.label}>
              {point.label}
            </div>
            {point.canFilter && (
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  onFilter();
                  onClose();
                }}
              >
                {point.filtered ? <FilterXIcon /> : <FilterIcon />}
                {point.filtered ? "Filter aufheben" : "Dashboard danach filtern"}
              </button>
            )}
            {point.canDrill && (
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  onDetails();
                  onClose();
                }}
              >
                <TableIcon />
                Details anzeigen
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
