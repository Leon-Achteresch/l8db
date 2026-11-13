import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useActiveConnection } from "@/lib/connections";
import {
  listGrantableObjects,
  listPrincipals,
  type PrincipalKind,
  principalDetail,
  principalOptions,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export function usePrincipalsQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["principals", connection?.id, database],
    queryFn: () =>
      listPrincipals(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: enabled && supports(connection, "principals"),
  });
}

export function usePrincipalDetailQuery(kind: PrincipalKind, name: string, enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["principal-detail", connection?.id, database, kind, name],
    queryFn: () =>
      principalDetail(
        connection!.kind,
        effectiveConnectionString(connection!),
        kind,
        name,
        database ?? undefined,
      ),
    enabled: enabled && supports(connection, "principals"),
  });
}

export function usePrincipalOptionsQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["principal-options", connection?.id, database],
    queryFn: () =>
      principalOptions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: enabled && supports(connection, "principals"),
  });
}

export function useGrantableObjectsQuery(owner: string, search: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["grantable-objects", connection?.id, database, owner, search],
    queryFn: () =>
      listGrantableObjects(
        connection!.kind,
        effectiveConnectionString(connection!),
        owner,
        search,
        database ?? undefined,
      ),
    enabled: owner !== "" && supports(connection, "principals"),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 30_000,
  });
}
