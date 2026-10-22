import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDebounced } from "@/features/dashboard/use-dataset-query";
import {
  type DatabaseListKind,
  supabaseStudioDatabaseList,
} from "@/lib/db/supabase-studio-database";

export const PAGE_SIZE = 100;

export const databaseListKey = (
  reference: string,
  kind: DatabaseListKind,
  schema: string,
  parent: string,
  search: string,
  offset: number,
) => ["supabase", reference, "studio-database", kind, schema, parent, search, offset] as const;

export function useDatabaseList<T>(
  reference: string,
  kind: DatabaseListKind,
  {
    schema = "",
    parent = "",
    enabled = true,
  }: { schema?: string; parent?: string; enabled?: boolean } = {},
) {
  const [search, setSearchValue] = useState("");
  const [offset, setOffset] = useState(0);
  const debounced = useDebounced(search.trim(), 300);
  const query = useQuery({
    queryKey: databaseListKey(reference, kind, schema, parent, debounced, offset),
    queryFn: () =>
      supabaseStudioDatabaseList<T>(reference, kind, { schema, parent, search: debounced, offset }),
    placeholderData: keepPreviousData,
    enabled,
  });
  const setSearch = (value: string) => {
    setSearchValue(value);
    setOffset(0);
  };
  return { query, search, setSearch, offset, setOffset };
}
