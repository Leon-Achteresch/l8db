import { Download, FolderTree, MoreHorizontal, Plus, Search, Star, Upload } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { IconMenu, IconMenuContent, IconMenuItem } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { HostGroupRule } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import { useHasNewFeatures } from "@/lib/new-features";

export function ConnectionsToolbar({
  connections,
  query,
  setQuery,
  favoritesOnly,
  setFavoritesOnly,
  openEditor,
  setImportOpen,
  setExportOpen,
  setRulesDialog,
}: {
  connections: SavedConnection[];
  query: string;
  setQuery: (value: string) => void;
  favoritesOnly: boolean;
  setFavoritesOnly: Dispatch<SetStateAction<boolean>>;
  openEditor: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setRulesDialog: (value: { draft: Omit<HostGroupRule, "id"> | null }) => void;
}) {
  const importIsNew = useHasNewFeatures("connections.import");
  return (
    <>
      {connections.length > 0 && (
        <>
          <div className="relative w-48 min-w-0 sm:w-64 md:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, Host, User suchen…"
              aria-label="Verbindungen suchen"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <Button
            variant={favoritesOnly ? "secondary" : "outline"}
            size="icon-sm"
            aria-pressed={favoritesOnly}
            aria-label={favoritesOnly ? "Alle anzeigen" : "Nur Favoriten"}
            onClick={() => setFavoritesOnly((value) => !value)}
            className={favoritesOnly ? "text-amber-500 border-amber-500/30" : ""}
          >
            <Star className={favoritesOnly ? "size-4 fill-current" : "size-4"} />
          </Button>
        </>
      )}
      <Button
        variant="default"
        size="sm"
        data-tour="connection-add"
        onClick={() => openEditor("new")}
        className="shadow-xs"
      >
        <Plus className="size-4" />
        Neue Verbindung
      </Button>
      {connections.length > 0 && (
        <IconMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={importIsNew ? "Weitere Aktionen, neue Funktionen" : "Weitere Aktionen"}
              className="relative"
            >
              <MoreHorizontal className="size-4" />
              {importIsNew && <NewBadge className="absolute -right-2 -top-1.5 px-1 text-[8px]" />}
            </Button>
          </DropdownMenuTrigger>
          <IconMenuContent>
            <IconMenuItem icon={<Upload />} label="Import" onSelect={() => setImportOpen(true)}>
              {importIsNew && <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />}
            </IconMenuItem>
            <IconMenuItem icon={<Download />} label="Export" onSelect={() => setExportOpen(true)} />
            <IconMenuItem
              icon={<FolderTree />}
              label="Gruppen-Regeln"
              onSelect={() => setRulesDialog({ draft: null })}
            />
          </IconMenuContent>
        </IconMenu>
      )}
    </>
  );
}
