import { expect, test } from "bun:test";
import {
  emptySupabaseSqlProject,
  forgetSupabaseSqlProjects,
  useSupabaseSqlStore,
} from "@/features/baas/supabase-studio/sql/supabase-sql-store";
import { forgetRecentTables } from "@/features/baas/supabase-studio/tables/supabase-tables-utils";

test("disconnecting Supabase removes stored SQL tabs, history and recent tables", () => {
  const entries = new Map<string, string>([
    ["l8db.supabase-studio.tables.recent.cloudref", "[]"],
    ["l8db.supabase-studio.tables.recent.self-abc", "[]"],
    ["other", "1"],
  ]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      removeItem: (key: string) => void entries.delete(key),
    },
  });
  try {
    const cloud = (reference: string) => !reference.startsWith("self-");
    forgetRecentTables(cloud);
    expect([...entries.keys()]).toEqual(["l8db.supabase-studio.tables.recent.self-abc", "other"]);
    useSupabaseSqlStore.setState({
      projects: { cloudref: emptySupabaseSqlProject(), "self-abc": emptySupabaseSqlProject() },
    });
    forgetSupabaseSqlProjects(cloud);
    expect(Object.keys(useSupabaseSqlStore.getState().projects)).toEqual(["self-abc"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
