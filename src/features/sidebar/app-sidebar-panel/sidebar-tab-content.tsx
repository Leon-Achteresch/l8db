import { SidebarPackageList } from "@/features/sidebar/sidebar-package-list";
import { SidebarProcedureList } from "@/features/sidebar/sidebar-procedure-list";
import { SidebarSynonymList } from "@/features/sidebar/sidebar-synonym-list";
import { SavedQueriesList } from "./saved-queries-list";
import { SidebarEntityList } from "./sidebar-entity-list";
import { SidebarExtensionList } from "./sidebar-extension-list";
import { SidebarFunctionList } from "./sidebar-function-list";
import { SidebarMatviewList } from "./sidebar-matview-list";
import { SidebarRoleList } from "./sidebar-role-list";
import { SidebarSequenceList } from "./sidebar-sequence-list";
import type { SidebarTabValue } from "./sidebar-tab";
import type { SidebarObjectQueries } from "./use-sidebar-object-queries";

interface SidebarTabContentProps {
  hasConnection: boolean;
  sidebarTab: SidebarTabValue;
  q: SidebarObjectQueries;
  packages: SidebarObjectQueries["functions"];
  plainFunctions: SidebarObjectQueries["functions"];
}

export function SidebarTabContent({
  hasConnection,
  sidebarTab,
  q,
  packages,
  plainFunctions,
}: SidebarTabContentProps) {
  return (
    <>
      {!hasConnection ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      ) : sidebarTab === "tables" ? (
        <SidebarEntityList
          items={q.tables}
          isLoading={q.tablesLoading}
          isError={q.tablesError}
          error={q.tablesErrorValue}
          emptyMessage="Keine Tabellen gefunden."
          type="table"
        />
      ) : sidebarTab === "views" ? (
        <>
          <SidebarEntityList
            items={q.views}
            isLoading={q.viewsLoading}
            isError={q.viewsError}
            error={q.viewsErrorValue}
            emptyMessage="Keine Views gefunden."
            type="view"
          />
          <SidebarMatviewList items={q.matviews} />
        </>
      ) : sidebarTab === "functions" ? (
        <SidebarFunctionList
          items={plainFunctions}
          isLoading={q.functionsLoading}
          isError={q.functionsError}
          error={q.functionsErrorValue}
        />
      ) : sidebarTab === "procedures" ? (
        <SidebarProcedureList
          items={q.procedures}
          isLoading={q.proceduresLoading}
          isError={q.proceduresError}
          error={q.proceduresErrorValue}
        />
      ) : sidebarTab === "packages" ? (
        <SidebarPackageList
          items={packages}
          isLoading={q.functionsLoading}
          isError={q.functionsError}
          error={q.functionsErrorValue}
        />
      ) : sidebarTab === "synonyms" ? (
        <SidebarSynonymList
          items={q.synonyms}
          isLoading={q.synonymsLoading}
          isError={q.synonymsError}
          error={q.synonymsErrorValue}
        />
      ) : sidebarTab === "extensions" ? (
        <SidebarExtensionList
          items={q.extensions}
          isLoading={q.extensionsLoading}
          isError={q.extensionsError}
          error={q.extensionsErrorValue}
        />
      ) : sidebarTab === "roles" ? (
        <SidebarRoleList
          items={q.roles}
          isLoading={q.rolesLoading}
          isError={q.rolesError}
          error={q.rolesErrorValue}
        />
      ) : sidebarTab === "sequences" ? (
        <SidebarSequenceList
          items={q.sequences}
          isLoading={q.sequencesLoading}
          isError={q.sequencesError}
          error={q.sequencesErrorValue}
        />
      ) : (
        <SavedQueriesList />
      )}
    </>
  );
}
