import { Link, type useMatchRoute } from "@tanstack/react-router";
import { Star, StarOff } from "lucide";
import { Columns2Icon, CopyIcon, EyeIcon, TableIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useMemo, useState } from "react";
import { SidebarSearchInput } from "@/components/sidebar-search-input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import type { SchemaCopyObjectType } from "@/lib/db";
import { buildInvalidSet, isViewInvalid } from "@/lib/invalid-objects";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { EntityConfirmDialog } from "./entity-confirm-dialog";
import { EntityMatchingColumns } from "./entity-matching-columns";
import { TableEntityMenuItems } from "./table-entity-menu-items";
import { useSidebarEntityActions } from "./use-sidebar-entity-actions";
import { useSidebarEntityFilter } from "./use-sidebar-entity-filter";

export interface SidebarEntityListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  emptyMessage: string;
  type: "table" | "view";
  matchRoute: ReturnType<typeof useMatchRoute>;
}

export function SidebarEntityList({
  items,
  isLoading,
  isError,
  error,
  emptyMessage,
  type,
  matchRoute,
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
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);
  const {
    confirmAction,
    setConfirmAction,
    actionLoading,
    caps,
    activeDatabase,
    handleConfirmAction,
    handleOpenInEditor,
    handleScriptTable,
    toggleFavoriteObject,
    isFavorite,
    handleFocusInErDiagram,
    handleAlterTable,
    openView,
  } = useSidebarEntityActions(type);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        {type === "table" ? "Lade Tabellen…" : "Lade Views…"}
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

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
      <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
      <EntityConfirmDialog
        confirmAction={confirmAction}
        actionLoading={actionLoading}
        isRedis={caps.query_language === "redis"}
        activeDatabase={activeDatabase}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
      {filtered && filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow
          count={filtered?.length ?? 0}
          disabled={filtered?.some((item) => item.matchingColumns.length > 0)}
        >
          {(index) => {
            const item = filtered![index];
            const isActive =
              type === "view"
                ? Boolean(
                    matchRoute({
                      to: "/view-editor/$schema/$view",
                      params: { schema: item.schema, view: item.name },
                    }),
                  )
                : Boolean(
                    matchRoute({
                      to: "/tables/$schema/$table",
                      params: { schema: item.schema, table: item.name },
                    }),
                  );

            const menuButton =
              type === "view" ? (
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => openView(item.schema, item.name)}
                >
                  <EyeIcon className="text-muted-foreground" />
                  <span className="truncate">{item.name}</span>
                  {isViewInvalid(invalidSet, item.schema, item.name) ? <InvalidMarker /> : null}
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link
                    to="/tables/$schema/$table"
                    params={{ schema: item.schema, table: item.name }}
                    search={{ type }}
                    data-tour={index === 0 && type === "table" ? "sidebar-table" : undefined}
                    data-schema={item.schema}
                    data-name={item.name}
                  >
                    <TableIcon className="text-muted-foreground" />
                    <span className="truncate">{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              );

            return (
              <SidebarMenuItem key={`${item.schema}.${item.name}`}>
                {type === "table" ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      <TableEntityMenuItems
                        schema={item.schema}
                        name={item.name}
                        caps={caps}
                        isFavorite={isFavorite(item.schema, item.name)}
                        onToggleFavorite={() => toggleFavoriteObject(item.schema, item.name)}
                        onOpenInEditor={() => handleOpenInEditor(item.schema, item.name)}
                        onScriptTable={() => handleScriptTable(item.schema, item.name)}
                        onCopy={() =>
                          setCopyTarget({
                            schema: item.schema,
                            name: item.name,
                            objectType: "table",
                          })
                        }
                        onAlterTable={() => handleAlterTable(item.schema, item.name)}
                        onFocusInErDiagram={() => handleFocusInErDiagram(item.schema, item.name)}
                        onConfirm={setConfirmAction}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                ) : (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => toggleFavoriteObject(item.schema, item.name)}
                      >
                        <MorphIcon icon={isFavorite(item.schema, item.name) ? StarOff : Star} />
                        {isFavorite(item.schema, item.name) ? "Favorit lösen" : "Anheften"}
                      </ContextMenuItem>
                      {caps.schema_object_copy && (
                        <ContextMenuItem
                          onSelect={() =>
                            setCopyTarget({
                              schema: item.schema,
                              name: item.name,
                              objectType: "view",
                            })
                          }
                        >
                          <CopyIcon />
                          In anderem Schema erstellen
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )}
                <EntityMatchingColumns
                  item={item}
                  type={type}
                  onOpenView={() => openView(item.schema, item.name)}
                />
              </SidebarMenuItem>
            );
          }}
        </SidebarWindow>
      )}
    </div>
  );
}
