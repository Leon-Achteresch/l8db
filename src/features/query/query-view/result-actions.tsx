import { Download, Loader } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QueryResult } from "@/lib/db";
import { DATA_EXPORT_FORMATS } from "@/lib/export-formats";
import { cn } from "@/lib/utils";

import type { ResultExportState } from "./use-result-export";

interface ResultActionsProps {
  result: QueryResult | null;
  exportState: ResultExportState;
}

export function ResultActions({ result, exportState }: ResultActionsProps) {
  const { exporting, partial, loadedRows, openCsvExport, openXlsxExport, openDataExport } =
    exportState;
  if (!result || result.columns.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" disabled={exporting}>
          <MorphIcon
            icon={exporting ? Loader : Download}
            className={cn("size-3", exporting && "animate-spin")}
          />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {partial && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Geladene Zeilen ({loadedRows.toLocaleString("de-DE")})
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={openCsvExport}>Als CSV exportieren…</DropdownMenuItem>
        <DropdownMenuItem onClick={openXlsxExport}>Als XLSX exportieren…</DropdownMenuItem>
        {DATA_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem key={format.value} onClick={() => openDataExport(format.value)}>
            Als {format.label} exportieren…
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => void exportState.handleExportJson()}>
          Als JSON exportieren
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
