import { Download, FolderTree, MoreHorizontal, Plus, Search, Star, Upload } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { HostGroupRule } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Weitere Aktionen">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Upload className="size-3.5" />
              Import
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setExportOpen(true)}>
              <Download className="size-3.5" />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRulesDialog({ draft: null })}>
              <FolderTree className="size-3.5" />
              Gruppen-Regeln
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
