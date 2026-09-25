import { Download, Loader } from "lucide";
import { TerminalIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QueryResult } from "@/lib/db";
import { DATA_EXPORT_FORMATS } from "@/lib/export-formats";
import { cn } from "@/lib/utils";

import type { ResultExportState } from "./use-result-export";

interface ResultActionsProps {
  result: QueryResult | null;
  serverOutput: boolean;
  outputOpen: boolean;
  connected: boolean;
  onToggleOutput: () => void;
  exportState: ResultExportState;
}

export function ResultActions({
  result,
  serverOutput,
  outputOpen,
  connected,
  onToggleOutput,
  exportState,
}: ResultActionsProps) {
  const { exporting, setCsvExportOpen, setXlsxExportOpen, setDataExportFormat, handleExportJson } =
    exportState;
  return (
    <>
      {serverOutput && (
        <Button
          size="icon-sm"
          variant={outputOpen ? "secondary" : "ghost"}
          aria-label="Server-Ausgabe umschalten"
          aria-pressed={outputOpen}
          title="Server-Ausgabe öffnen"
          disabled={!connected}
          onClick={onToggleOutput}
        >
          <TerminalIcon className="size-3.5" />
        </Button>
      )}
      {result && result.columns.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={exporting}
            >
              <MorphIcon
                icon={exporting ? Loader : Download}
                className={cn("size-3", exporting && "animate-spin")}
              />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setCsvExportOpen(true)}>
              Als CSV exportieren…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setXlsxExportOpen(true)}>
              Als XLSX exportieren…
            </DropdownMenuItem>
            {DATA_EXPORT_FORMATS.map((format) => (
              <DropdownMenuItem
                key={format.value}
                onClick={() => setDataExportFormat(format.value)}
              >
                Als {format.label} exportieren…
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => void handleExportJson()}>
              Als JSON exportieren
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
