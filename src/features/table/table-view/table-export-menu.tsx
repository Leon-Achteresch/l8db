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
import { useRef, useState } from "react";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuSub, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DATA_EXPORT_FORMATS, type DataExportFormat } from "@/lib/export-formats";
import { BusinessTimeZoneContext } from "../business-time-zone-context";
import { BusinessTimeZoneDialog } from "../business-time-zone-dialog";

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

export function TableActionsMenu({
  children,
  isNew = false,
  businessTimeZone = false,
}: {
  children: React.ReactNode;
  isNew?: boolean;
  businessTimeZone?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const pendingTimeZone = useRef(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  return (
    <BusinessTimeZoneContext.Provider
      value={
        businessTimeZone
          ? () => {
              pendingTimeZone.current = true;
            }
          : null
      }
    >
      <IconMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={button}
            data-feature="table.export"
            size="icon"
            variant="ghost"
            className="relative size-7"
            aria-label="Weitere Aktionen"
            title="Weitere Aktionen"
            data-tour="table-add"
          >
            <EllipsisIcon className="size-3.5" />
            {isNew && <NewBadge className="absolute -right-1 -top-1" />}
          </Button>
        </DropdownMenuTrigger>
        <IconMenuContent
          onCloseAutoFocus={(event) => {
            if (!pendingTimeZone.current) return;
            pendingTimeZone.current = false;
            if (!businessTimeZone) return;
            event.preventDefault();
            setZoneOpen(true);
          }}
        >
          {children}
        </IconMenuContent>
      </IconMenu>
      {businessTimeZone && zoneOpen ? (
        <BusinessTimeZoneDialog
          onClose={() => setZoneOpen(false)}
          returnFocus={() => button.current?.focus({ preventScroll: true })}
        />
      ) : null}
    </BusinessTimeZoneContext.Provider>
  );
}
