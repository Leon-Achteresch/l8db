import { expect, test } from "bun:test";
import { createConnectionListing } from "@/features/connections/connections-view/connection-listing";
import type { SavedConnection } from "@/lib/connections/types";

function profile(id: string, name: string, host: string): SavedConnection {
  return {
    id,
    name,
    kind: "postgres",
    sslMode: "disable",
    connectionString: `postgres://leser:geheim@${host}:5432/lager`,
  };
}

test("group names, profile metadata and favorites preserve the order and scope of matches", () => {
  const a = { ...profile("a", "Zulu", "pg-1"), favorite: true, schemas: ["archiv"] };
  const b = { ...profile("b", "Alpha", "pg-2"), tags: [{ name: "Rechnung", color: "blau" }] };
  const c = profile("c", "Mitte", "extern");
  const rules = [{ id: "office", name: "Buchhaltung", pattern: "pg-*" }];
  const list = createConnectionListing([a, b, c], [], rules, [], []);
  expect(list.filter("", false).connections).toEqual([b, c, a]);
  const full = list.filter("  HALTUNG ", false);
  expect(full.connections).toEqual([b, a]);
  expect(full.groups).toHaveLength(1);
  expect(full.groups[0]).toBe(list.groups.find((group) => group.ruleId === "office"));
  expect(list.filter("Buchhaltung", true).connections).toEqual([a]);
  expect(list.filter("Rechnung", true).connections).toEqual([]);
  expect(list.hasFavorites).toBe(true);
  for (const [query, expected] of [
    ["Rechnung", [b]],
    ["archiv", [a]],
    ["pg-2", [b]],
    ["leser", [b, c, a]],
    ["geheim", []],
  ] as const)
    expect(list.filter(query, false).connections).toEqual(expected);
  const changed = createConnectionListing(
    [a, b, c],
    [],
    [{ ...rules[0], name: "Finanzen" }],
    ["rule|office"],
    [],
  );
  expect(changed.filter("Buchhaltung", false).connections).toEqual([]);
  expect(changed.filter("Finanzen", true).connections).toEqual([b, a]);
  expect(createConnectionListing([c], [], rules, ["rule|office"], []).hasFavorites).toBe(false);
});

test("Supabase project cards cover their represented SQL profiles while unrelated profiles stay searchable", () => {
  const ref = "abcdefghijklmnopqrst";
  const cloud = profile("cloud", "Cloud SQL", `db.${ref}.supabase.co`);
  const local = profile("local", "Eigene Cloud", "db.corp.example");
  const other = profile("other", "Andere Cloud", "db.corp.example");
  const baas = [
    { provider: "supabase" as const, id: ref, name: "Cloud", detail: "Frankfurt" },
    {
      provider: "supabase" as const,
      id: "local-project",
      name: "Eigene Cloud",
      detail: "Lokal",
      url: "https://corp.example",
    },
  ];
  const list = createConnectionListing([cloud, local, other], baas, [], [], []);
  expect(list.count).toBe(1);
  expect(list.filter("Cloud", false).connections).toEqual([other]);
  expect(createConnectionListing([cloud, local, other], [], [], [], []).count).toBe(3);
});

test("2,048 saved profiles resolve searchable metadata once across successive searches", () => {
  let reads = 0;
  const rules = Array.from({ length: 16 }, (_, i) => ({
    id: `r${i}`,
    name: `Fachbereich ${i}`,
    pattern: `team${i}-*`,
  }));
  const entries = Array.from({ length: 2048 }, (_, i) => {
    const raw = `postgres://reader@team${i % 32}-db.corp:5432/lager`;
    return {
      id: `id${i}`,
      name: `Profil ${String(i).padStart(4, "0")}`,
      kind: "postgres" as const,
      sslMode: "disable" as const,
      favorite: i % 7 === 0,
      get connectionString() {
        reads++;
        return raw;
      },
    };
  });
  const listing = createConnectionListing(entries, [], rules, ["rule|r0", "rule|r3"], []);
  expect(reads).toBe(entries.length);
  const unfiltered = listing.filter("", false);
  expect(listing.filter("   ", false).groups).toBe(unfiltered.groups);
  const samples: number[] = [];
  for (let i = 0; i < 22; i++) {
    const start = performance.now();
    const found = listing.filter(`Profil ${String(i * 21).padStart(4, "0")}`, i % 2 === 1);
    if (i) samples.push(performance.now() - start);
    expect(found.connections).toEqual([entries[i * 21]]);
    expect(found.groups).toHaveLength(1);
    expect(reads).toBe(2 * entries.length);
  }
  expect(listing.filter("Fachbereich 12", false).connections).toHaveLength(64);
  expect(listing.filter("", false).connections).toBe(unfiltered.connections);
  expect(reads).toBe(2 * entries.length);
  samples.sort((a, b) => a - b);
  console.log("Verbindungssuche", {
    profiles: entries.length,
    reads,
    median: samples[10],
    p95: samples[19],
  });
  expect(samples[10]).toBeLessThan(6);
  expect(samples[19]).toBeLessThan(16);
});

test("Supabase cards reuse the first matching database and release obsolete matches", () => {
  const ref = "abcdefghijklmnopqrst";
  const cloud = { provider: "supabase" as const, id: ref, name: "Cloud", detail: "" };
  const local = { ...cloud, id: "self-hosted-one", name: "Lab", url: "http://example.test:8000" };
  const secondLocal = { ...local, id: "second", url: "https://example.test:443" };
  const invalid = { ...local, id: "broken", url: "ungültig" };
  const ignored = { ...cloud, provider: "firebase" as const };
  const direct = profile("direct", "Anderer Name", `db.${ref}.supabase.co`);
  const pool = {
    ...direct,
    id: "pool",
    connectionString: `postgres://postgres%2E${ref}@eu.pooler.supabase.com/postgres`,
  };
  const first = profile("local1", "Lab", "db.example.test");
  const second = profile("local2", "Lab", "example.test");
  const other = profile("other", "Test", "db.example.test");
  const bad = { ...other, id: "bad", connectionString: "keine URL" };
  const brokenPool = {
    ...other,
    id: "pool-error",
    connectionString: "postgres://postgres.%FF@eu.pooler.supabase.com/db",
  };
  const projects = [cloud, local, secondLocal, invalid, ignored];
  const list = createConnectionListing(
    [pool, direct, first, second, bad, brokenPool, other],
    projects,
    [],
    [],
    [],
  );
  expect(list.count).toBe(3);
  expect(list.databaseByProject.get(cloud)).toBe(pool);
  expect(list.databaseByProject.get(local)).toBe(first);
  expect(list.databaseByProject.get(secondLocal)).toBe(first);
  expect(list.databaseByProject.size).toBe(3);
  const changed = createConnectionListing([second, direct, other], [local], [], [], []);
  expect(changed.databaseByProject.get(local)).toBe(second);
  expect(changed.databaseByProject.size).toBe(1);
  expect(changed.count).toBe(2);
});

test("256 cloud project cards share one matching pass over 1,024 SQL profiles", () => {
  const ref = (i: number) => String(i).padStart(20, "a");
  let reads = 0;
  const profiles = Array.from({ length: 1024 }, (_, i) => {
    const index = i - 832;
    const name = index >= 128 ? `Lokal ${index}` : `SQL ${i}`;
    const host =
      index < 0
        ? `host${i % 16}.example`
        : index < 128
          ? `db.${ref(index)}.supabase.co`
          : `db.site${index}.example`;
    const url = `postgres://reader@${host}:5432/app`;
    return {
      ...profile(`c${i}`, name, host),
      get connectionString() {
        reads++;
        return url;
      },
    };
  });
  const projects = Array.from({ length: 256 }, (_, i) =>
    i < 128
      ? { id: ref(i), provider: "supabase" as const, name: `Cloud ${i}`, detail: "EU" }
      : i < 192
        ? {
            id: `local${i}`,
            provider: "supabase" as const,
            name: `Lokal ${i}`,
            url: `https://site${i}.example`,
            detail: "EU",
          }
        : { id: `app${i}`, provider: "appwrite" as const, name: `App ${i}`, detail: "EU" },
  );
  const samples: number[] = [];
  for (let pass = 0; pass <= 21; pass++) {
    reads = 0;
    const start = performance.now();
    const list = createConnectionListing(profiles, projects, [], [], []);
    const beforeCards = reads;
    const matches = projects.map((project) => list.databaseByProject.get(project));
    if (pass) samples.push(performance.now() - start);
    expect(list.count).toBe(832);
    expect(list.databaseByProject.size).toBe(192);
    expect(matches.filter(Boolean).length).toBe(192);
    expect(reads).toBe(profiles.length + list.count);
    expect(reads).toBe(beforeCards);
  }
  samples.sort((a, b) => a - b);
  console.log("Cloud SQL profiles", { reads, median: samples[10], p95: samples[19] });
  expect(samples[10]).toBeLessThan(10);
  expect(samples[19]).toBeLessThan(25);
});
