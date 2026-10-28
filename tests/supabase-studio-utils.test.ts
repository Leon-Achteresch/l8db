import { expect, test } from "bun:test";
import { apiValue } from "@/features/baas/supabase-studio/tables/supabase-tables-utils";
import type { StudioColumn } from "@/lib/db/supabase-studio-tables";

const column = (data_type: string) => ({ name: "c", data_type }) as StudioColumn;

test("apiValue sendet Arrays auch im SQL-Modus als Array", () => {
  expect(apiValue('["a","c"]', column("text[]"), ["a"], true)).toEqual(["a", "c"]);
  expect(() => apiValue("{a,c}", column("text[]"), null, true)).toThrow();
  expect(apiValue('{"n":1}', column("jsonb"), null, true)).toBe('{"n":1}');
  expect(apiValue("5", column("integer"), 4, true)).toBe("5");
  expect(apiValue("5", column("integer"), 4, false)).toBe(5);
});

test("Supabase-SQL-Store schreibt Tastendrücke gebündelt und begrenzt den Verlauf", async () => {
  const { appendSupabaseSqlHistory, emptySupabaseSqlProject, useSupabaseSqlStore } = await import(
    "@/features/baas/supabase-studio/sql/supabase-sql-store"
  );
  const original = window.localStorage.setItem;
  let writes = 0;
  window.localStorage.setItem = (key: string, value: string) => {
    if (key === "l8db.supabase-studio-sql") writes++;
    original(key, value);
  };
  try {
    const initial = emptySupabaseSqlProject();
    const started = performance.now();
    for (let i = 0; i < 500; i++) {
      useSupabaseSqlStore
        .getState()
        .update(
          "proj",
          (project) => ({ tabs: [{ ...project.tabs[0], sql: "x".repeat(i) }] }),
          initial,
        );
    }
    expect(performance.now() - started).toBeLessThan(500);
    expect(writes).toBe(0);
    await Bun.sleep(400);
    expect(writes).toBe(1);
  } finally {
    window.localStorage.setItem = original;
  }
  let history = appendSupabaseSqlHistory([], { sql: "x", at: 0, ok: true, rows: 0, durationMs: 0 });
  for (let i = 0; i < 200; i++) {
    history = appendSupabaseSqlHistory(history, {
      sql: `${i}`.padEnd(50_000, "-"),
      at: i,
      ok: true,
      rows: 0,
      durationMs: 0,
    });
  }
  expect(history).toHaveLength(50);
  expect(JSON.stringify(history).length).toBeLessThan(1_100_000);
});
