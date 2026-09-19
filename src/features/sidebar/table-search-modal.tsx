import { Columns2Icon, DatabaseIcon, RegexIcon, SearchIcon, TableIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableContentSearch } from "@/features/sidebar/table-content-search";
import { EntityFilterPanel } from "@/features/sidebar/table-search-modal/entity-filter-panel";
import { EntityResultList } from "@/features/sidebar/table-search-modal/entity-result-list";
import type { SearchMode } from "@/features/sidebar/table-search-modal/types";
import { useTableSearch } from "@/features/sidebar/table-search-modal/use-table-search";
import { cn } from "@/lib/utils";

interface TableSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TableSearchModal({ open, onOpenChange }: TableSearchModalProps) {
  const search = useTableSearch(open, onOpenChange);
  const {
    searchMode,
    setSearchMode,
    nameQuery,
    setNameQuery,
    useRegex,
    setUseRegex,
    regexError,
    searchIncludeColumns,
    setSearchIncludeColumns,
    filteredEntities,
    selectedEntity,
    handleSelectEntity,
    handleOpenDirect,
  } = search;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Erweiterte Suche</DialogTitle>
        <DialogDescription>
          Tabellen und Views nach Namen, Spalten oder Inhalten durchsuchen
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <div className="border-b px-3 py-2">
          <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as SearchMode)}>
            <TabsList className="w-full">
              <TabsTrigger value="objects" className="flex-1">
                <TableIcon className="size-3" />
                Objekte
              </TabsTrigger>
              <TabsTrigger value="content" className="flex-1">
                <DatabaseIcon className="size-3" />
                Inhalt
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {searchMode === "content" ? (
          <TableContentSearch onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={
                  searchIncludeColumns
                    ? "Tabellen, Views & Spalten suchen... (mehrere mit ; trennen)"
                    : "Tabellen & Views suchen... (mehrere mit ; trennen)"
                }
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                className={cn(
                  "h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
                  regexError && "text-destructive",
                )}
                autoFocus
              />
              <TooltipProvider delayDuration={350}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Toggle
                      size="sm"
                      variant="outline"
                      pressed={searchIncludeColumns}
                      onPressedChange={setSearchIncludeColumns}
                      aria-label="Spalten in Suche einbeziehen"
                      className="h-7 shrink-0 px-1.5"
                    >
                      <Columns2Icon className="size-3.5" />
                    </Toggle>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {searchIncludeColumns ? "Spaltensuche deaktivieren" : "Spaltensuche aktivieren"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Toggle
                size="sm"
                variant="outline"
                pressed={useRegex}
                onPressedChange={setUseRegex}
                aria-label="Regex-Modus"
                className="h-7 shrink-0 px-1.5"
              >
                <RegexIcon className="size-3.5" />
              </Toggle>
            </div>

            {regexError && (
              <p className="border-b px-3 py-1 text-xs text-destructive">
                Ungultiger Regex: {regexError}
              </p>
            )}

            <div className="flex min-h-0 flex-1">
              <EntityResultList
                filteredEntities={filteredEntities}
                selectedEntity={selectedEntity}
                onSelect={handleSelectEntity}
                onOpenDirect={handleOpenDirect}
              />

              <EntityFilterPanel {...search} />
            </div>

            <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/60">
              <span>
                <kbd className="rounded border border-border/40 bg-background/60 px-1 font-sans">
                  ;
                </kbd>{" "}
                mehrere Muster
              </span>
              <span>Doppelklick = direkt offnen</span>
              {useRegex && <span className="ml-auto font-mono text-blue-400/70">regex</span>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
