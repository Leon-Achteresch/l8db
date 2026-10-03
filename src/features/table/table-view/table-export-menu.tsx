import {
  BracesIcon,
  CodeXmlIcon,
  Columns3Icon,
  DatabaseIcon,
  DownloadIcon,
  EllipsisIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderIcon,
  SheetIcon,
} from "lucide-react";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenuSub, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DATA_EXPORT_FORMATS, type DataExportFormat } from "@/lib/export-formats";

const FORMAT_ICONS: Record<DataExportFormat, typeof FileTextIcon> = {
  parquet: Columns3Icon,
  xml: CodeXmlIcon,
  html: GlobeIcon,
};

export function TableExportMenu({
  exporting,
  showSql,
  onCsv,
  onXlsx,
  onFormat,
  onExport,
}: {
  exporting: boolean;
  showSql: boolean;
  onCsv: () => void;
  onXlsx: () => void;
  onFormat: (format: DataExportFormat) => void;
  onExport: (format: "json" | "sql") => void;
}) {
  return (
    <DropdownMenuSub>
      <IconMenuSubTrigger
        disabled={exporting}
        label="Export"
        icon={exporting ? <LoaderIcon className="animate-spin" /> : <DownloadIcon />}
      />
      <IconMenuSubContent>
        <IconMenuItem icon={<FileTextIcon />} label="Als CSV exportieren…" onSelect={onCsv} />
        <IconMenuItem icon={<SheetIcon />} label="Als XLSX exportieren…" onSelect={onXlsx} />
        {DATA_EXPORT_FORMATS.map((format) => {
          const Icon = FORMAT_ICONS[format.value];
          return (
            <IconMenuItem
              key={format.value}
              icon={<Icon />}
              label={`Als ${format.label} exportieren…`}
              onSelect={() => onFormat(format.value)}
            />
          );
        })}
        <IconMenuItem
          icon={<BracesIcon />}
          label="Als JSON exportieren"
          onSelect={() => void onExport("json")}
        />
        {showSql && (
          <IconMenuItem
            icon={<DatabaseIcon />}
            label="Als INSERT-SQL exportieren"
            onSelect={() => void onExport("sql")}
          />
        )}
      </IconMenuSubContent>
    </DropdownMenuSub>
  );
}

export function TableActionsMenu({ children }: { children: React.ReactNode }) {
  return (
    <IconMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Weitere Aktionen"
          data-tour="table-add"
        >
          <EllipsisIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <IconMenuContent>{children}</IconMenuContent>
    </IconMenu>
  );
}
