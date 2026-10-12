import { useNavigate } from "@tanstack/react-router";
import { BracesIcon, PackageIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { CopyAsMenu } from "@/components/copy-as-menu";
import { SidebarSearchInput } from "@/components/sidebar-search-input";
import { ToolsMenu } from "@/components/tools-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { copyNameActions } from "@/lib/clipboard";
import type { SchemaCopyObjectType } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
import { buildInvalidSet, isFunctionInvalid, isPackageInvalid } from "@/lib/invalid-objects";
import { usePaneTabTarget } from "@/lib/pane-tab-target";
import { packageOid } from "@/lib/plsql";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { compileSearchPatterns, splitSearchPatterns } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { useSidebarSearch } from "@/lib/sidebar-search";
import { useTableTabs } from "@/lib/table-tabs";

export interface SidebarFunctionListProps {
  items:
    | { schema: string; name: string; identity_args: string; oid: string; return_type: string }[]
    | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarFunctionList({
  items,
  isLoading,
  isError,
  error,
}: SidebarFunctionListProps) {
  const [search, setSearch] = useSidebarSearch("functions");
  const deferredSearch = useDeferredValue(search);
  const regexEnabled = useRegexEnabled("sidebar");
  const setRegexEnabled = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const compiled = useMemo(
    () =>
      regexEnabled && deferredSearch.trim() !== ""
        ? compileSearchPatterns(deferredSearch, { global: false })
        : null,
    [regexEnabled, deferredSearch],
  );
  const regexError = compiled && !compiled.ok ? compiled.error : null;
  const filtered = useMemo(() => {
    const patterns = splitSearchPatterns(deferredSearch);
    if (patterns.length === 0 || (compiled && !compiled.ok)) return items;
    const matches = compiled?.ok
      ? (value: string) => compiled.regexes.some((regex) => regex.test(value))
      : (value: string) => {
          const lower = value.toLowerCase();
          return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
        };
    return items?.filter((item) => matches(item.name) || matches(item.identity_args));
  }, [items, deferredSearch, compiled]);
  const navigate = useNavigate();
  const openFunctionTab = useTableTabs((state) => state.openFunctionTab);
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  const target = usePaneTabTarget();
  const caps = useActiveCapabilities();
  const { compile } = useCompileObject();
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Funktionen…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Funktionen gefunden.</p>;
  }

  const open = (item: NonNullable<SidebarFunctionListProps["items"]>[number]) => {
    if (target) {
      target.open(
        item.return_type === "PACKAGE"
          ? { kind: "package", schema: item.schema, name: item.name }
          : {
              kind: "function",
              schema: item.schema,
              name: item.name,
              oid: item.oid,
            },
      );
      return;
    }
    if (item.return_type === "PACKAGE") {
      openPackageTab({ schema: item.schema, name: item.name });
      navigate({
        to: "/packages/$schema/$name",
        params: { schema: item.schema, name: item.name },
      });
      return;
    }
    openFunctionTab({
      schema: item.schema,
      name: item.name,
      oid: item.oid,
    });
    navigate({
      to: "/functions/$schema/$name",
      params: { schema: item.schema, name: item.name },
      search: { oid: item.oid },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="sticky top-0 z-10 flex items-center bg-sidebar py-1">
        <SidebarSearchInput
          placeholder="Funktionen…"
          value={search}
          onChange={setSearch}
          regexEnabled={regexEnabled}
          onRegexEnabledChange={(enabled) => setRegexEnabled("sidebar", enabled)}
          regexError={regexError}
        />
      </div>
      {filtered && filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow count={filtered?.length ?? 0}>
          {(index) => {
            const item = filtered![index];
            const invalid =
              item.return_type === "PACKAGE"
                ? isPackageInvalid(invalidSet, item.schema, item.name)
                : isFunctionInvalid(invalidSet, item.schema, item.name);
            const qualifiedName = `${item.schema}.${item.name}`;
            return (
              <SidebarMenuItem key={item.oid}>
                <ContextMenu>
                  <ContextMenuTrigger
                    asChild
                    onKeyDown={menuKeyHandler(copyNameActions(item.name, qualifiedName))}
                  >
                    <SidebarMenuButton onClick={() => open(item)}>
                      {item.return_type === "PACKAGE" ? (
                        <PackageIcon className="text-muted-foreground" />
                      ) : (
                        <BracesIcon className="text-muted-foreground" />
                      )}
                      <span className="truncate">
                        {item.name}
                        {item.return_type === "PACKAGE"
                          ? ""
                          : item.identity_args
                            ? `(${item.identity_args})`
                            : "()"}
                      </span>
                      {invalid ? <InvalidMarker /> : null}
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => open(item)}>
                      Öffnen
                      <ContextMenuShortcut>
                        {formatMenuShortcut(MENU_KEYS.open)}
                      </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <CopyAsMenu name={item.name} qualifiedName={qualifiedName} shortcuts />
                    <ContextMenuSeparator />
                    {caps.compile_objects &&
                      (item.return_type === "PACKAGE" ? (
                        <>
                          <ContextMenuItem
                            onSelect={() => {
                              void compile(
                                packageOid(item.schema, item.name, "spec"),
                                "package_spec",
                                `${qualifiedName} (Spec)`,
                              );
                            }}
                          >
                            Spec kompilieren
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              void compile(
                                packageOid(item.schema, item.name, "body"),
                                "package_body",
                                `${qualifiedName} (Body)`,
                              );
                            }}
                          >
                            Body kompilieren
                          </ContextMenuItem>
                        </>
                      ) : (
                        <ContextMenuItem
                          onSelect={() => {
                            void compile(item.oid, "function", qualifiedName);
                          }}
                        >
                          Kompilieren
                        </ContextMenuItem>
                      ))}
                    <ToolsMenu>
                      <CompareObjectMenuItem
                        schema={item.schema}
                        name={item.name}
                        objectType={item.return_type === "PACKAGE" ? "package" : "routine"}
                        oid={item.oid}
                        identityArgs={item.identity_args}
                      />
                      {caps.schema_object_copy && item.return_type !== "PACKAGE" && (
                        <ContextMenuItem
                          onSelect={() =>
                            setCopyTarget({
                              schema: item.schema,
                              name: item.name,
                              objectType: "routine",
                            })
                          }
                        >
                          In anderem Schema erstellen…
                        </ContextMenuItem>
                      )}
                    </ToolsMenu>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            );
          }}
        </SidebarWindow>
      )}
      <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
    </div>
  );
}
