import { useNavigate } from "@tanstack/react-router";
import { DatabaseIcon, KeyRoundIcon, LayersIcon, WrenchIcon } from "lucide-react";
import { DatabaseLogo, SchemaLogo } from "@/components/named-logo";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { connectionUser } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import type { useActiveCapabilities } from "@/lib/db-selection";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import type { SidebarScope } from "./use-sidebar-scope";

interface SidebarScopeSelectsProps {
  activeConnection: SavedConnection;
  caps: ReturnType<typeof useActiveCapabilities>;
  isSwitching: boolean;
  scope: SidebarScope;
  onManageSchemas: () => void;
}

export function SidebarScopeSelects({
  activeConnection,
  caps,
  isSwitching,
  scope,
  onManageSchemas,
}: SidebarScopeSelectsProps) {
  const navigate = useNavigate();
  const {
    setDatabase,
    setSchema,
    activeDatabase,
    activeSchema,
    databases,
    databasesLoading,
    schemas,
    schemasLoading,
    siblings,
    activeUser,
  } = scope;
  const showSchemaSwitcher =
    activeConnection.showSingleSchemaSwitcher !== false ||
    schemas?.length !== 1 ||
    siblings.length > 0;
  return (
    <div className="grid min-w-0 gap-2" data-tour="sidebar-scope">
      {caps.databases && (
        <div className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Datenbank</span>
          <Select
            value={activeDatabase ?? undefined}
            onValueChange={(value) => setDatabase(activeConnection.id, value)}
            disabled={databasesLoading}
          >
            <SelectTrigger
              size="sm"
              className="w-full min-w-0"
              aria-label="Datenbank"
              title={activeDatabase ?? undefined}
            >
              {activeDatabase && databases?.includes(activeDatabase) ? null : (
                <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <SelectValue placeholder="Wählen…" />
            </SelectTrigger>
            <SelectContent searchable collisionPadding={{ top: 48 }}>
              {(databases ?? []).map((database) => (
                <SelectItem key={database} value={database}>
                  <span className="flex min-w-0 items-center gap-2">
                    <DatabaseLogo name={database} kind={activeConnection.kind} />
                    <span className="truncate">{database}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {caps.schemas && caps.query_language !== "json" && (
        <div className="grid min-w-0 flex-1 gap-1.5">
          <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            {showSchemaSwitcher ? "Schema" : `Schema: ${activeSchema}`}
            <button
              type="button"
              onClick={onManageSchemas}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
              title="Schemas verwalten"
            >
              <WrenchIcon className="size-3" />
            </button>
          </span>
          {showSchemaSwitcher && (
            <Select
              value={activeSchema}
              onValueChange={(value) => {
                if (value.startsWith("conn:")) {
                  if (useConnectionSwitch.getState().isSwitching) return;
                  void activateConnectionWithToast(value.slice(5)).then((ok) => {
                    if (ok) void navigate({ to: "/" });
                  });
                  return;
                }
                setSchema(activeConnection.id, value);
              }}
              disabled={schemasLoading || isSwitching}
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0"
                aria-label="Schema"
                title={activeSchema}
              >
                {schemas?.includes(activeSchema) ? null : (
                  <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <SelectValue placeholder="Wählen…" />
              </SelectTrigger>
              <SelectContent searchable collisionPadding={{ top: 48 }}>
                {siblings.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                      <KeyRoundIcon className="size-3" />
                      Mit eigenem Login
                    </SelectLabel>
                    {siblings.map((connection) => (
                      <SelectItem key={connection.id} value={`conn:${connection.id}`}>
                        <span className="flex min-w-0 items-center gap-2">
                          <SchemaLogo name={connectionUser(connection) || connection.name} />
                          <span className="truncate">
                            {connectionUser(connection) || connection.name}
                          </span>
                          {connectionUser(connection) && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {connection.name}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                  </SelectGroup>
                )}
                {(schemas ?? []).map((schema) => (
                  <SelectItem key={schema} value={schema}>
                    <span className="flex min-w-0 items-center gap-2">
                      <SchemaLogo name={schema} />
                      <span className="truncate">{schema}</span>
                      {schema.toLowerCase() === activeUser.toLowerCase() && (
                        <KeyRoundIcon className="size-3 shrink-0 text-muted-foreground" />
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
