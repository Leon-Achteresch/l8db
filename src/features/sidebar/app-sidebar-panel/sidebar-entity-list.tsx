import { Columns2Icon } from "lucide-react";
import { SidebarSearchInput } from "@/components/sidebar-search-input";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarEntityResults } from "./sidebar-entity-results";
import { SidebarPickResults } from "./sidebar-pick-results";
import { useSidebarEntityFilter } from "./use-sidebar-entity-filter";

export interface SidebarEntityListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  emptyMessage: string;
  type: "table" | "view";
  activeItem?: string | null;
  onPick?: (schema: string, name: string) => void;
}

export function SidebarEntityList({
  items,
  isLoading,
  isError,
  error,
  emptyMessage,
  type,
  activeItem,
  onPick,
}: SidebarEntityListProps) {
  const {
    search,
    setSearch,
    searchIncludeColumns,
    setSearchIncludeColumns,
    regexEnabled,
    setRegexEnabled,
    regexError,
    filtered,
  } = useSidebarEntityFilter(items, type);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        {type === "table" ? "Lade Tabellen…" : "Lade Views…"}
      </div>
    );
  }

  if (isError) return <SidebarQueryError error={error} />;
  if (!items?.length) return <p className="py-1 text-sm text-muted-foreground">{emptyMessage}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar py-1"
        data-tour="sidebar-search"
      >
        <SidebarSearchInput
          placeholder={
            searchIncludeColumns
              ? type === "table"
                ? "Tabellen & Spalten…"
                : "Views & Spalten…"
              : type === "table"
                ? "Tabellen…"
                : "Views…"
          }
          value={search}
          onChange={setSearch}
          regexEnabled={regexEnabled}
          onRegexEnabledChange={(enabled) => setRegexEnabled("sidebar", enabled)}
          regexError={regexError}
        />
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
      </div>
      {onPick ? (
        <SidebarPickResults
          filtered={filtered ?? []}
          type={type}
          activeItem={activeItem}
          onPick={onPick}
        />
      ) : (
        <SidebarEntityResults filtered={filtered ?? []} type={type} />
      )}
    </div>
  );
}
