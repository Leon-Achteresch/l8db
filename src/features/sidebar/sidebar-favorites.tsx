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
import { Button } from "@/components/ui/button";
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
            return (
              <SidebarMenuItem key={id} className="group/favorite">
                <SidebarMenuButton
                  onClick={() => {
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
                  }}
                  title={`${favorite.schema}.${favorite.name}`}
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
                <div className="flex items-center gap-0.5 px-2 pb-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Nach oben"
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ChevronUpIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Nach unten"
                    disabled={index === scoped.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ChevronDownIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Favorit entfernen"
                    onClick={() => remove(id)}
                  >
                    <StarOffIcon className="size-3" />
                  </Button>
                  {missing ? (
                    <span className="ml-1 text-xs text-destructive">nicht gefunden</span>
                  ) : null}
                </div>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
