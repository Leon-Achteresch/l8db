import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  LayersIcon,
  StarOffIcon,
  TableIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  favoriteId,
  favoritesFor,
  type ObjectFavorite,
  useObjectFavoritesStore,
} from "@/lib/object-favorites";
import { useAllSchemaObjectsQuery, useMaterializedViewsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

function iconFor(type: ObjectFavorite["type"]) {
  if (type === "view") return EyeIcon;
  if (type === "matview") return LayersIcon;
  return TableIcon;
}

export function SidebarFavorites() {
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const favorites = useObjectFavoritesStore((state) => state.favorites);
  const remove = useObjectFavoritesStore((state) => state.remove);
  const move = useObjectFavoritesStore((state) => state.move);
  const openViewEditorTab = useTableTabs((state) => state.openViewEditorTab);
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
            const Icon = iconFor(favorite.type);
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
            return (
              <SidebarMenuItem key={id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <SidebarMenuButton
                      onClick={open}
                      title={
                        missing
                          ? `${favorite.schema}.${favorite.name} (nicht gefunden)`
                          : `${favorite.schema}.${favorite.name}`
                      }
                    >
                      {missing ? (
                        <TriangleAlertIcon className="text-destructive" />
                      ) : (
                        <Icon className="text-muted-foreground" />
                      )}
                      <span className="truncate">{favorite.name}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {favorite.schema}
                      </span>
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={open}>Öffnen</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem disabled={index === 0} onSelect={() => move(id, -1)}>
                      <ChevronUpIcon />
                      Nach oben
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={index === scoped.length - 1}
                      onSelect={() => move(id, 1)}
                    >
                      <ChevronDownIcon />
                      Nach unten
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => remove(id)}>
                      <StarOffIcon />
                      Favorit entfernen
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
