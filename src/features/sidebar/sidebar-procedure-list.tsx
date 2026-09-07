import { useNavigate } from "@tanstack/react-router";
import { HammerIcon, SquareFunctionIcon } from "lucide-react";
import { useMemo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { useActiveCapabilities } from "@/lib/db-selection";
import { buildInvalidSet, isProcedureInvalid } from "@/lib/invalid-objects";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

interface SidebarProcedureListProps {
  items: { schema: string; name: string; identity_args: string; oid: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarProcedureList({
  items,
  isLoading,
  isError,
  error,
}: SidebarProcedureListProps) {
  const navigate = useNavigate();
  const openProcedureTab = useTableTabs((state) => state.openProcedureTab);
  const capabilities = useActiveCapabilities();
  const { compile } = useCompileObject();
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Prozeduren…
      </div>
    );
  }
  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }
  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Prozeduren gefunden.</p>;
  }

  const open = (item: { schema: string; name: string; oid: string }) => {
    openProcedureTab({ schema: item.schema, name: item.name, oid: item.oid });
    void navigate({
      to: "/procedures/$schema/$name",
      params: { schema: item.schema, name: item.name },
      search: { oid: item.oid },
    });
  };

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.oid}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <SidebarMenuButton onClick={() => open(item)}>
                <SquareFunctionIcon className="text-muted-foreground" />
                <span className="truncate">
                  {item.name}
                  {item.identity_args ? `(${item.identity_args})` : "()"}
                </span>
                {isProcedureInvalid(invalidSet, item.schema, item.name) ? <InvalidMarker /> : null}
              </SidebarMenuButton>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => open(item)}>Öffnen</ContextMenuItem>
              {capabilities.compile_objects ? (
                <ContextMenuItem
                  onSelect={() => {
                    void compile(item.oid, "procedure", `${item.schema}.${item.name}`);
                  }}
                >
                  <HammerIcon />
                  Kompilieren
                </ContextMenuItem>
              ) : null}
            </ContextMenuContent>
          </ContextMenu>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
