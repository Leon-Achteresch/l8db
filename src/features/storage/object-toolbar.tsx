import {
  ArchiveIcon,
  CopyIcon,
  DownloadIcon,
  FolderInputIcon,
  FolderPlusIcon,
  HistoryIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { breadcrumbs } from "@/lib/storage/s3";
import { cn } from "@/lib/utils";

export function ObjectToolbar({
  bucket,
  prefix,
  readOnly,
  filter,
  search,
  showVersions,
  selectedCount,
  fetching,
  onNavigate,
  onFilter,
  onSearch,
  onShowVersions,
  onRefresh,
  onUploadFiles,
  onUploadFolder,
  onUploadOptions,
  onNewFolder,
  onDownload,
  onCopy,
  onMove,
  onDelete,
}: {
  bucket: string;
  prefix: string;
  readOnly: boolean;
  filter: string;
  search: string;
  showVersions: boolean;
  selectedCount: number;
  fetching: boolean;
  onNavigate: (prefix: string) => void;
  onFilter: (value: string) => void;
  onSearch: (value: string) => void;
  onShowVersions: (value: boolean) => void;
  onRefresh: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onUploadOptions: () => void;
  onNewFolder: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(search || filter);
  useEffect(() => {
    if (!search && !filter) setText("");
  }, [search, filter]);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
      <nav aria-label="Pfad" className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-muted"
          onClick={() => onNavigate("")}
        >
          <ArchiveIcon className="size-3.5 text-orange-500" />
          {bucket}
        </button>
        {breadcrumbs(prefix).map((crumb) => (
          <span key={crumb.prefix} className="flex items-center gap-0.5">
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className={cn(
                "max-w-48 truncate rounded px-1.5 py-0.5 hover:bg-muted",
                crumb.prefix === prefix && "font-medium",
              )}
              onClick={() => onNavigate(crumb.prefix)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-1">
        <form
          className="relative mr-1 w-64"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(text.trim());
          }}
        >
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Objekte filtern"
            className="h-8 pr-7 pl-7 text-xs"
            placeholder="Filtern · Enter sucht rekursiv"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (search) onSearch("");
              onFilter(event.target.value);
            }}
          />
          {text ? (
            <button
              type="button"
              aria-label="Suche leeren"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setText("");
                onFilter("");
                onSearch("");
              }}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </form>
        <IconButton
          size="icon-sm"
          variant={showVersions ? "secondary" : "ghost"}
          aria-pressed={showVersions}
          aria-label={showVersions ? "Versionen ausblenden" : "Versionen anzeigen"}
          onClick={() => onShowVersions(!showVersions)}
        >
          <HistoryIcon className={cn(showVersions && "text-primary")} />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" aria-label="Aktualisieren" onClick={onRefresh}>
          <RefreshCwIcon className={cn(fetching && "animate-spin")} />
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          {selectedCount > 0 && (
            <>
              <span className="mr-1 text-xs text-muted-foreground tabular-nums">
                {selectedCount} ausgewählt
              </span>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label="Herunterladen"
                onClick={onDownload}
              >
                <DownloadIcon />
              </IconButton>
              {!readOnly && (
                <>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Kopieren nach…"
                    onClick={onCopy}
                  >
                    <CopyIcon />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Verschieben nach…"
                    onClick={onMove}
                  >
                    <FolderInputIcon />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Löschen"
                    onClick={onDelete}
                  >
                    <TrashIcon />
                  </IconButton>
                </>
              )}
              {!readOnly && <Separator orientation="vertical" className="mx-1 h-5" />}
            </>
          )}
          {!readOnly && (
            <>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label="Neuer Ordner"
                onClick={onNewFolder}
              >
                <FolderPlusIcon />
              </IconButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton size="icon-sm" aria-label="Hochladen">
                    <UploadIcon />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onSelect={onUploadFiles}>
                    <UploadIcon /> Dateien…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onUploadFolder}>
                    <FolderInputIcon /> Ordner…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onUploadOptions}>
                    <SlidersHorizontalIcon /> Mit Optionen…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
