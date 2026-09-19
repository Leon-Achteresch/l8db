import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveConnection } from "@/lib/connections";
import {
  compileInvalidObjects,
  getFunctionDefinition,
  listCompileErrors,
  listExtensions,
  listFunctions,
  listInvalidObjects,
  listProcedures,
  listRolePrivileges,
  listRoles,
} from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export function useFunctionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["functions", connection?.id, database, schema],
    queryFn: () =>
      listFunctions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "functions"),
  });
}

export function useProceduresQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["procedures", connection?.id, database, schema],
    queryFn: () =>
      listProcedures(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: enabled && supports(connection, "procedures"),
  });
}

export function useFunctionDefinitionQuery(oid: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["function-definition", connection?.id, database, oid],
    queryFn: () =>
      getFunctionDefinition(
        connection!.kind,
        effectiveConnectionString(connection!),
        oid,
        database ?? undefined,
      ),
    enabled:
      (supports(connection, "functions") || supports(connection, "procedures")) && Boolean(oid),
  });
}

export function useInvalidObjectsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["invalid-objects", connection?.id, database, schema],
    queryFn: () =>
      listInvalidObjects(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "compile_objects"),
    staleTime: 15_000,
  });
}

export function useCompileErrorsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["compile-errors", connection?.id, database, schema],
    queryFn: () =>
      listCompileErrors(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "compile_objects"),
    staleTime: 15_000,
  });
}

export function useCompileInvalidObjectsMutation() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      compileInvalidObjects(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invalid-objects"] });
      queryClient.invalidateQueries({ queryKey: ["compile-errors"] });
      queryClient.invalidateQueries({ queryKey: ["functions"] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      queryClient.invalidateQueries({ queryKey: ["views"] });
      queryClient.invalidateQueries({ queryKey: ["synonyms"] });
      queryClient.invalidateQueries({ queryKey: ["function-definition"] });
    },
  });
}

export function useExtensionsQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["extensions", connection?.id, database],
    queryFn: () =>
      listExtensions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: enabled && supports(connection, "extensions"),
  });
}

export function useRolesQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["roles", connection?.id, database],
    queryFn: () =>
      listRoles(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: enabled && supports(connection, "roles"),
  });
}

export function useRolePrivilegesQuery(roleName: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["role-privileges", connection?.id, database, roleName],
    queryFn: () =>
      listRolePrivileges(
        connection!.kind,
        effectiveConnectionString(connection!),
        roleName,
        database ?? undefined,
      ),
    enabled: supports(connection, "privileges") && Boolean(roleName),
  });
}
