import {
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useProceduresQuery,
  useRolesQuery,
  useSequencesQuery,
  useSynonymsQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import type { SidebarTabValue } from "./sidebar-tab";

export function useSidebarObjectQueries(selectedTab: SidebarTabValue) {
  const {
    data: tables,
    isLoading: tablesLoading,
    isError: tablesError,
    error: tablesErrorValue,
  } = useTablesQuery();
  const {
    data: views,
    isLoading: viewsLoading,
    isError: viewsError,
    error: viewsErrorValue,
  } = useViewsQuery(selectedTab === "views");
  const {
    data: functions,
    isLoading: functionsLoading,
    isError: functionsError,
    error: functionsErrorValue,
  } = useFunctionsQuery();
  const {
    data: procedures,
    isLoading: proceduresLoading,
    isError: proceduresError,
    error: proceduresErrorValue,
  } = useProceduresQuery(selectedTab === "procedures");
  const {
    data: synonyms,
    isLoading: synonymsLoading,
    isError: synonymsError,
    error: synonymsErrorValue,
  } = useSynonymsQuery(undefined, selectedTab === "synonyms");
  const {
    data: extensions,
    isLoading: extensionsLoading,
    isError: extensionsError,
    error: extensionsErrorValue,
  } = useExtensionsQuery(selectedTab === "extensions");
  const {
    data: roles,
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesErrorValue,
  } = useRolesQuery(selectedTab === "roles");

  const {
    data: sequences,
    isLoading: sequencesLoading,
    isError: sequencesError,
    error: sequencesErrorValue,
  } = useSequencesQuery(selectedTab === "sequences");

  const { data: matviews } = useMaterializedViewsQuery(undefined, selectedTab === "views");

  return {
    tables,
    tablesLoading,
    tablesError,
    tablesErrorValue,
    views,
    viewsLoading,
    viewsError,
    viewsErrorValue,
    functions,
    functionsLoading,
    functionsError,
    functionsErrorValue,
    procedures,
    proceduresLoading,
    proceduresError,
    proceduresErrorValue,
    synonyms,
    synonymsLoading,
    synonymsError,
    synonymsErrorValue,
    extensions,
    extensionsLoading,
    extensionsError,
    extensionsErrorValue,
    roles,
    rolesLoading,
    rolesError,
    rolesErrorValue,
    sequences,
    sequencesLoading,
    sequencesError,
    sequencesErrorValue,
    matviews,
  };
}

export type SidebarObjectQueries = ReturnType<typeof useSidebarObjectQueries>;
