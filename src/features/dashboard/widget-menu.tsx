import { DownloadIcon, EllipsisIcon, FilterXIcon, TableIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WidgetMenu({
  onDetails,
  onExport,
  onClearFilter,
}: {
  onDetails?: () => void;
  onExport?: () => void;
  onClearFilter?: () => void;
}) {
  if (!onDetails && !onExport && !onClearFilter) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" size="icon-xs" aria-label="Weitere Aktionen">
          <EllipsisIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onDetails && (
          <DropdownMenuItem onSelect={onDetails}>
            <TableIcon /> Details anzeigen
          </DropdownMenuItem>
        )}
        {onExport && (
          <DropdownMenuItem onSelect={onExport}>
            <DownloadIcon /> Daten als CSV exportieren
          </DropdownMenuItem>
        )}
        {onClearFilter && (
          <DropdownMenuItem onSelect={onClearFilter}>
            <FilterXIcon /> Auswahl-Filter aufheben
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
