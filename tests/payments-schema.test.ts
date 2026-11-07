import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";

const url = process.env.L8DB_PAYMENTS_PG_URL;
const SCHEMA = await Bun.file(
  new URL("../src-tauri/src/payments/schema.sql", import.meta.url),
).text();
const USER = "3f2a7c1e-9b4d-4e8f-a1c2-0d9e8f7a6b5c";
let db: SQL;

const event = (id: string, created: number, status: string) => ({
  id,
  type: "customer.subscription.updated",
  created,
  livemode: false,
  data: { object: { id: "sub_1", object: "subscription", status } },
});

async function as<T>(role: string, work: (sql: SQL) => Promise<T>): Promise<T> {
  const connection = await db.reserve();
  try {
    await connection.unsafe(`SET ROLE ${role}`);
    return await work(connection);
  } finally {
    await connection.unsafe("RESET ROLE");
    connection.release();
  }
}

beforeAll(async () => {
  if (!url) return;
  db = new SQL(url, { max: 1 });
  await db.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$`);
  await db.unsafe(
    "DROP SCHEMA IF EXISTS l8db_billing CASCADE; DROP FUNCTION IF EXISTS public.l8db_billing_apply_event(jsonb, text); DROP FUNCTION IF EXISTS public.l8db_billing_customer(text, uuid, text);",
  );
});

afterAll(async () => {
  if (!url) return;
  await db.unsafe(
    "DROP SCHEMA IF EXISTS l8db_billing CASCADE; DROP FUNCTION IF EXISTS public.l8db_billing_apply_event(jsonb, text); DROP FUNCTION IF EXISTS public.l8db_billing_customer(text, uuid, text);",
  );
  await db.close();
});

describe.skipIf(!url)("Zahlungs-Schema in echtem PostgreSQL", () => {
  test("lässt sich wiederholt ausführen und behält Daten", async () => {
    await db.unsafe(SCHEMA);
    await as(
      "service_role",
      (sql) =>
        sql`select public.l8db_billing_apply_event(${event("evt_keep", 10, "active")}::jsonb, 'acct_1')`,
    );
    await db.unsafe(SCHEMA);
    const [row] =
      await db`select count(*)::int as count from l8db_billing.events where id = 'evt_keep'`;
    expect(row.count).toBe(1);
    const tables =
      await db`select relname, relrowsecurity from pg_class where relnamespace = 'l8db_billing'::regnamespace and relkind = 'r' order by relname`;
    expect(tables).toEqual([
      { relname: "customers", relrowsecurity: true },
      { relname: "events", relrowsecurity: true },
      { relname: "objects", relrowsecurity: true },
    ]);
  });

  test("anon und authenticated erreichen weder Tabellen noch Funktionen", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(as(role, (sql) => sql`select * from l8db_billing.events`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        as(
          role,
          (sql) =>
            sql`select public.l8db_billing_apply_event(${event("evt_x", 1, "active")}::jsonb, 'acct_1')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(
          role,
          (sql) => sql`select public.l8db_billing_customer('acct_1', ${USER}::uuid, 'cus_evil')`,
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      as("service_role", (sql) => sql`select * from l8db_billing.customers`),
    ).rejects.toThrow(/permission denied/);
  });

  test("dedupliziert Ereignisse und überschreibt Objekte nur mit neueren", async () => {
    const apply = (id: string, created: number, status: string) =>
      as("service_role", async (sql) => {
        const [row] =
          await sql`select public.l8db_billing_apply_event(${event(id, created, status)}::jsonb, 'acct_1') as applied`;
        return row.applied as boolean;
      });
    expect(await apply("evt_new", 200, "past_due")).toBe(true);
    expect(await apply("evt_new", 200, "past_due")).toBe(false);
    expect(await apply("evt_old", 100, "active")).toBe(true);
    const [object] =
      await db`select payload->>'status' as status, event_id from l8db_billing.objects where id = 'sub_1'`;
    expect(object).toEqual({ status: "past_due", event_id: "evt_new" });
    const [count] = await db`select count(*)::int as count from l8db_billing.events`;
    expect(count.count).toBe(3);
    await expect(
      as(
        "service_role",
        (sql) => sql`select public.l8db_billing_apply_event('{"id":"bad"}'::jsonb, 'acct_1')`,
      ),
    ).rejects.toThrow(/invalid billing event/);
    await expect(
      as(
        "service_role",
        (sql) =>
          sql`select public.l8db_billing_apply_event(${event("evt_y", 1, "a")}::jsonb, 'nope')`,
      ),
    ).rejects.toThrow(/invalid billing event/);
  });

  test("ordnet Kunden je Stripe-Konto genau einmal zu", async () => {
    const link = (account: string, customer: string | null) =>
      as("service_role", async (sql) => {
        const [row] =
          await sql`select public.l8db_billing_customer(${account}, ${USER}::uuid, ${customer}) as id`;
        return row.id as string | null;
      });
    expect(await link("acct_1", null)).toBeNull();
    expect(await link("acct_1", "cus_first")).toBe("cus_first");
    expect(await link("acct_1", "cus_second")).toBe("cus_first");
    expect(await link("acct_live", null)).toBeNull();
    expect(await link("acct_live", "cus_live")).toBe("cus_live");
    await expect(link("acct_1", "cus_bad;drop")).rejects.toThrow(/invalid billing customer/);
  });
});
