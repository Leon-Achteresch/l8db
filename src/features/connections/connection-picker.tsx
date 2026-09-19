import { CheckIcon, SearchIcon, StarIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { connectionUser, groupByServer, sortServerGroups } from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import { sortConnectionsByName, useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { compileSearchPatterns, splitSearchPatterns } from "@/lib/regex-search";
import { useRegexEnabled } from "@/lib/regex-search-prefs";

interface ConnectionPickerProps {
  value: string | null;
  onSelect: (id: string) => void;
  trigger: ReactNode;
  footer?: ReactNode;
  disabled?: boolean;
  busyId?: string | null;
  kind?: DatabaseKind;
  label?: string;
  contentClassName?: string;
}

export function ConnectionPicker({
  value,
  onSelect,
  trigger,
  footer,
  disabled = false,
  busyId = null,
  kind,
  label = "Verbindung wechseln",
  contentClassName,
}: ConnectionPickerProps) {
  const allConnections = useConnectionsStore((state) => state.connections);
  const favoriteServerKeys = useConnectionsStore((state) => state.favoriteServerKeys);
  const serverOrder = useConnectionsStore((state) => state.serverOrder);
  const hostGroupRules = useConnectionsStore((state) => state.hostGroupRules);
  const connections = useMemo(
    () => (kind ? allConnections.filter((entry) => entry.kind === kind) : allConnections),
    [allConnections, kind],
  );
  const serverGroups = useMemo(
    () =>
      sortServerGroups(
        groupByServer(sortConnectionsByName(connections), hostGroupRules),
        favoriteServerKeys,
        serverOrder,
      ),
    [connections, favoriteServerKeys, serverOrder, hostGroupRules],
  );
  const grouped = serverGroups.some((group) => group.connections.length > 1 || group.ruleId);
  const [connectionSearch, setConnectionSearch] = useState("");
  const connectionSearchRef = useRef<HTMLInputElement>(null);
  const focusConnectionSearch = useCallback((node: HTMLInputElement | null) => {
    connectionSearchRef.current = node;
    if (node) requestAnimationFrame(() => node.focus());
  }, []);
  const connectionRegexEnabled = useRegexEnabled("sidebar");
  const connectionSearchPatterns = useMemo(
    () =>
      connectionRegexEnabled && connectionSearch.trim() !== ""
        ? compileSearchPatterns(connectionSearch, { global: false })
        : null,
    [connectionRegexEnabled, connectionSearch],
  );
  const filteredServerGroups = useMemo(() => {
    const query = connectionSearch.trim().toLowerCase();
    if (!query) return serverGroups;
    const patterns = splitSearchPatterns(connectionSearch).map((pattern) => pattern.toLowerCase());
    const matches = (value: string) => {
      const lower = value.toLowerCase();
      if (patterns.some((pattern) => lower.includes(pattern))) return true;
      return (
        connectionSearchPatterns?.ok === true &&
        connectionSearchPatterns.regexes.some((regex) => regex.test(value))
      );
    };

    return serverGroups
      .map((group) => {
        const connectionsInGroup = group.connections.filter((connection) => {
          return [
            group.label,
            connection.name,
            connection.kind,
            connectionUser(connection),
            ...(connection.tags?.map((tag) => tag.name) ?? []),
          ].some(matches);
        });
        return connectionsInGroup.length > 0 ? { ...group, connections: connectionsInGroup } : null;
      })
      .filter((group): group is (typeof serverGroups)[number] => group !== null);
  }, [connectionSearch, connectionSearchPatterns, serverGroups]);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setConnectionSearch("");
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={
          contentClassName ??
          "flex max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-56 flex-col overflow-hidden"
        }
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {connections.length > 0 && (
          <div className="relative px-1 pb-1.5">
            <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
            <Input
              ref={focusConnectionSearch}
              value={connectionSearch}
              onChange={(event) => setConnectionSearch(event.target.value)}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key))
                  event.stopPropagation();
              }}
              placeholder="Verbindungen suchen…"
              aria-label="Verbindungen suchen"
              autoComplete="off"
              spellCheck={false}
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}
        <div
          role="group"
          className="min-h-0 flex-1 overflow-y-auto"
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key.length !== 1 && event.key !== "Backspace") return;
            event.stopPropagation();
            connectionSearchRef.current?.focus();
          }}
        >
          {connections.length === 0 ? (
            <DropdownMenuItem disabled>Keine Verbindungen gespeichert</DropdownMenuItem>
          ) : filteredServerGroups.length === 0 ? (
            <DropdownMenuItem disabled>Keine Treffer</DropdownMenuItem>
          ) : (
            filteredServerGroups.map((group) => (
              <DropdownMenuGroup key={group.key}>
                {grouped && (
                  <DropdownMenuLabel className="flex items-center gap-1.5 pt-2 font-mono text-[10px] font-normal text-muted-foreground">
                    <ProviderLogo
                      providerId={providerFor(group.connections[0]).id}
                      kind={group.kind}
                      className="size-3"
                    />
                    <span className="truncate">{group.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {group.connections.length}
                    </span>
                    {favoriteServerKeys.includes(group.key) && (
                      <StarIcon className="size-3 fill-current text-amber-500" />
                    )}
                  </DropdownMenuLabel>
                )}
                {group.connections.map((connection) => (
                  <DropdownMenuItem
                    key={connection.id}
                    disabled={disabled}
                    onSelect={() => onSelect(connection.id)}
                  >
                    <ConnectionStatusIndicator connectionId={connection.id} />
                    {!grouped ? (
                      <ProviderLogo
                        providerId={providerFor(connection).id}
                        kind={connection.kind}
                      />
                    ) : null}
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{connection.name}</span>
                      {grouped && connectionUser(connection) && (
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {connectionUser(connection)}
                        </span>
                      )}
                      {connection.tags?.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </span>
                    {busyId === connection.id ? (
                      <Spinner className="size-4" />
                    ) : connection.id === value ? (
                      <CheckIcon className="size-4" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))
          )}
        </div>
        {footer ? (
          <div className="mt-1 shrink-0 border-t border-border/70 pt-1">{footer}</div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
