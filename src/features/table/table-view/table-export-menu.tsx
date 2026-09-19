import { Download, Loader } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TableExportMenu({
  exporting,
  showSql,
  onCsv,
  onXlsx,
  onExport,
}: {
  exporting: boolean;
  showSql: boolean;
  onCsv: () => void;
  onXlsx: () => void;
  onExport: (format: "json" | "sql") => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Export"
              disabled={exporting}
            >
              <MorphIcon
                icon={exporting ? Loader : Download}
                className={cn("size-3.5", exporting && "animate-spin")}
              />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Export</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCsv}>Als CSV exportieren…</DropdownMenuItem>
        <DropdownMenuItem onClick={onXlsx}>Als XLSX exportieren…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void onExport("json")}>
          Als JSON exportieren
        </DropdownMenuItem>
        {showSql && (
          <DropdownMenuItem onClick={() => void onExport("sql")}>
            Als INSERT-SQL exportieren
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
