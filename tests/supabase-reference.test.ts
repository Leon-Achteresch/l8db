import { expect, test } from "bun:test";
import { supabaseReferenceOf } from "@/features/baas/use-supabase-database";
import type { SavedConnection } from "@/lib/connections";

const connection = (connectionString: string, kind: SavedConnection["kind"] = "postgres") =>
  ({ id: "c", name: "c", kind, connectionString, sslMode: "require" }) as SavedConnection;

test("erkennt Supabase-Projekte über direkte und Pooler-Adressen", () => {
  expect(
    supabaseReferenceOf(
      connection("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"),
    ),
  ).toBe("abcdefghijklmnopqrst");
  expect(
    supabaseReferenceOf(
      connection(
        "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres",
      ),
    ),
  ).toBe("abcdefghijklmnopqrst");
  expect(
    supabaseReferenceOf(
      connection("postgresql://postgres.abcdefghijklmnopqrst:pw@evil.example.com:5432/postgres"),
    ),
  ).toBeNull();
  expect(
    supabaseReferenceOf(connection("postgresql://postgres@localhost:5432/postgres")),
  ).toBeNull();
  expect(
    supabaseReferenceOf(connection("mysql://db.abcdefghijklmnopqrst.supabase.co", "mysql")),
  ).toBeNull();
});
