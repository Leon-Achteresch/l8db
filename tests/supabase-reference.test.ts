import { expect, test } from "bun:test";
import {
  isSelfHostedSupabaseDatabase,
  supabaseReferenceOf,
} from "@/features/baas/use-supabase-database";
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

test("ordnet selbst gehostete Datenbanken über Host und Namen zu", () => {
  const local = {
    ...connection("postgresql://postgres.t:pw@127.0.0.1:5432/postgres"),
    name: "Lab",
  };
  expect(isSelfHostedSupabaseDatabase(local, "http://127.0.0.1:8000/", "Lab")).toBe(true);
  expect(isSelfHostedSupabaseDatabase(local, "http://127.0.0.1:8000/", "Andere")).toBe(false);
  expect(isSelfHostedSupabaseDatabase(local, "https://supabase.example.com/", "Lab")).toBe(false);
  expect(
    isSelfHostedSupabaseDatabase({ ...local, kind: "mysql" }, "http://127.0.0.1:8000/", "Lab"),
  ).toBe(false);
  expect(isSelfHostedSupabaseDatabase(local, "kein url", "Lab")).toBe(false);
});
