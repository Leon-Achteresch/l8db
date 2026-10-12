import { useNavigate } from "@tanstack/react-router";
import { Eye, Layers, Table, TriangleAlert } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useMemo } from "react";
import { CopyAsMenu } from "@/components/copy-as-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { copyNameActions } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
import {
  favoriteId,
  favoritesFor,
  type ObjectFavorite,
  useObjectFavoritesStore,
} from "@/lib/object-favorites";
import { useAllSchemaObjectsQuery, useMaterializedViewsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

function iconFor(type: ObjectFavorite["type"]) {
  if (type === "view") return Eye;
  if (type === "matview") return Layers;
  return Table;
}

export function SidebarFavorites() {
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const favorites = useObjectFavoritesStore((state) => state.favorites);
  const remove = useObjectFavoritesStore((state) => state.remove);
  const move = useObjectFavoritesStore((state) => state.move);
  const openViewEditorTab = useTableTabs((state) => state.openViewEditorTab);
  const openTab = useTableTabs((state) => state.openTab);
  const scoped = useMemo(
    () => favoritesFor(favorites, connection?.id, database),
    [favorites, connection?.id, database],
  );
  const { data: objects } = useAllSchemaObjectsQuery(scoped.length > 0);
  const { data: matviews } = useMaterializedViewsQuery();

  const known = useMemo(() => {
    const set = new Set<string>();
    for (const item of objects?.tables ?? []) set.add(`table:${item.schema}.${item.name}`);
    for (const item of objects?.views ?? []) set.add(`view:${item.schema}.${item.name}`);
    for (const item of matviews ?? []) set.add(`matview:${item.schema}.${item.name}`);
    return set;
  }, [objects, matviews]);

  const hasLists = Boolean(objects);

  if (!connection || scoped.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Favoriten</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {scoped.map((favorite, index) => {
            const id = favoriteId(favorite);
            const icon = iconFor(favorite.type);
            const missing =
              hasLists && !known.has(`${favorite.type}:${favorite.schema}.${favorite.name}`);
            const open = () => {
              if (favorite.type === "view") {
                openViewEditorTab({ schema: favorite.schema, view: favorite.name });
                void navigate({
                  to: "/view-editor/$schema/$view",
                  params: { schema: favorite.schema, view: favorite.name },
                });
                return;
              }
              if (favorite.type === "matview") {
                void navigate({
                  to: "/matviews/$schema/$name",
                  params: { schema: favorite.schema, name: favorite.name },
                });
                return;
              }
              void navigate({
                to: "/tables/$schema/$table",
                params: { schema: favorite.schema, table: favorite.name },
              });
            };
            const openInNewTab =
              favorite.type === "table"
                ? () => openTab({ schema: favorite.schema, table: favorite.name })
                : favorite.type === "view"
                  ? () => openViewEditorTab({ schema: favorite.schema, view: favorite.name })
                  : undefined;
            const qualifiedName = `${favorite.schema}.${favorite.name}`;
            return (
              <SidebarMenuItem key={id}>
                <ContextMenu>
                  <ContextMenuTrigger
                    asChild
                    onKeyDown={menuKeyHandler({
                      openInNewTab,
                      ...copyNameActions(favorite.name, qualifiedName),
                    })}
                  >
                    <SidebarMenuButton
                      onClick={open}
                      title={
                        missing
                          ? `${favorite.schema}.${favorite.name} (nicht gefunden)`
                          : `${favorite.schema}.${favorite.name}`
                      }
                    >
                      <MorphIcon
                        icon={missing ? TriangleAlert : icon}
                        className={missing ? "text-destructive" : "text-muted-foreground"}
                      />
                      <span className="truncate">{favorite.name}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {favorite.schema}
                      </span>
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={open}>
                      Öffnen
                      <ContextMenuShortcut>
                        {formatMenuShortcut(MENU_KEYS.open)}
                      </ContextMenuShortcut>
                    </ContextMenuItem>
                    {openInNewTab && (
                      <ContextMenuItem onSelect={openInNewTab}>
                        In neuem Tab öffnen
                        <ContextMenuShortcut>
                          {formatMenuShortcut(MENU_KEYS.openInNewTab)}
                        </ContextMenuShortcut>
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <CopyAsMenu name={favorite.name} qualifiedName={qualifiedName} shortcuts />
                    <ContextMenuSeparator />
                    <ContextMenuItem disabled={index === 0} onSelect={() => move(id, -1)}>
                      Nach oben
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={index === scoped.length - 1}
                      onSelect={() => move(id, 1)}
                    >
                      Nach unten
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => remove(id)}>
                      Aus Favoriten entfernen
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
