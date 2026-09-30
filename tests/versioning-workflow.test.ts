import { describe, expect, test } from "bun:test";
import { generateMigration } from "../src/lib/versioning/migrations";
import { checksum } from "../src/lib/versioning/model";
import { seedBranchAllowed, seedStatementCount } from "../src/lib/versioning/seeds";
import type { DatabaseRelease, DatabaseTarget, ObjectSnapshot, RepositoryStatus } from "../src/lib/versioning/types";
import { customerGroups, graphLanes, parseGitGraph, targetProgress } from "../src/lib/versioning/workflow";

const status: RepositoryStatus = { repo: "/repo", head: "a".repeat(40), branch: "main", branches: ["main"], files: [], changes: "", history: "" };
const release = (id: string, parent: string | null, objects: ObjectSnapshot[] = []): DatabaseRelease => ({ format: 1, id, projectId: "p", kind: "postgres", parent, createdAt: "2026-09-30T12:00:00Z", objects, migrations: [] });
const target = (name: string, version: string | null = "v1"): DatabaseTarget => ({ id: name, name, connectionId: name, database: "app", schema: "public", production: true, release: version ? { id: version, commit: "a".repeat(40), path: `database/releases/${version}.json` } : null, history: [] });
const table = async (name: string, definition: string): Promise<ObjectSnapshot> => ({ object: { id: name, path: `database/objects/${name}.sql`, selection: { schema: "public", objectType: "table", objectName: name, objectOid: null } }, definition, checksum: await checksum(definition) });
const definition = (name = "people") => `TABLE public.${name}\nCOLUMNS\n  id integer NOT NULL PRIMARY KEY\n  email text NULL`;

describe("versioning workflow", () => {
  test("groups environments across servers under their customer and keeps legacy targets", () => {
    const groups = customerGroups([{ ...target("Prod"), customer: "Nord", environment: "Produktion" }, { ...target("Dev"), customer: "Nord", environment: "Development" }, target("Legacy")]);
    expect(groups.map((group) => [group.customer, group.targets.length])).toEqual([["Nord", 2], ["Legacy", 1]]);
  });
  test("counts only committed updates on the target lineage", () => {
    const releases = [release("v1", null), release("v2", "v1"), release("v3", "v2"), { ...release("custom", "v1"), track: "custom" }];
    expect(targetProgress(target("Nord"), releases, status).pending).toBe(2);
    expect(targetProgress({ ...target("Nord"), pinnedRelease: "v2" }, releases, status).pending).toBe(1);
    expect(targetProgress(target("Nord"), releases, { ...status, changes: " M database/releases/v3.json\0" }).pending).toBe(1);
    expect(targetProgress(target("Nord"), releases, { ...status, head: null }).pending).toBe(0);
    expect(targetProgress({ ...target("Nord"), paused: true }, releases, status).state).toBe("paused");
    expect(targetProgress(target("New", null), releases, status).state).toBe("baseline");
    expect(targetProgress(target("Fork", "other"), releases, status).pending).toBe(0);
  });
  test("preserves fork and merge edges in Git swimlanes", () => {
    const ids = ["a", "b", "c", "d"].map((letter) => letter.repeat(40));
    const commits = parseGitGraph(`${ids[0]}\t${ids[1]} ${ids[2]}\tHEAD -> main\t2026-09-30T12:00:00Z\tMerge billing\n${ids[1]}\t${ids[3]}\t\t2026-09-30T11:00:00Z\tBase update\n${ids[2]}\t${ids[3]}\tfeature/billing\t2026-09-30T10:00:00Z\tBilling\n${ids[3]}\t\t\t2026-09-29T12:00:00Z\tBaseline\n`);
    const lanes = graphLanes(commits);
    expect(lanes[0].edges).toHaveLength(2);
    expect(lanes[1].width).toBe(2);
    expect(lanes[2].edges.some((edge) => edge.active && edge.to === 0)).toBe(true);
    expect(lanes[3].edges).toEqual([]);
    expect(parseGitGraph("invalid\t\t\t\ttext")).toEqual([]);
  });
});

describe("automatic release migrations", () => {
  test("generates new tables and changed columns in one migration", async () => {
    const old = await table("people", definition());
    const changed = await table("people", definition() + "\n  active boolean NULL DEFAULT false");
    const added = await table("notes", definition("notes"));
    const draft = generateMigration("postgres", release("v1", null, [old]), [changed, added]);
    expect(draft.issues).toEqual([]);
    expect(draft.sql).toContain('CREATE TABLE "public"."notes"');
    expect(draft.sql).toContain('PRIMARY KEY ("id")');
    expect(draft.sql).toContain('ALTER TABLE "public"."people" ADD COLUMN "active" boolean DEFAULT false;');
    expect(draft.changes.every((change) => change.generated)).toBe(true);
  });
  test("new table constraints retain names and avoid duplicating primary key indexes", async () => {
    const added = await table("people", definition() + '\nCONSTRAINTS\npeople_pkey PRIMARY KEY (id) PRIMARY KEY (id)\nINDEXES\n  CREATE UNIQUE INDEX people_pkey ON public.people USING btree (id)\n  CREATE INDEX people_email ON public.people USING btree (email)');
    const draft = generateMigration("postgres", release("v1", null), [added]);
    expect(draft.issues).toEqual([]);
    expect(draft.sql).toContain('CONSTRAINT "people_pkey" PRIMARY KEY (id)');
    expect(draft.sql).not.toContain("CREATE UNIQUE INDEX people_pkey");
    expect(draft.sql).toContain("CREATE INDEX people_email");
  });
  test("unsupported changes stay actionable without discarding other generated SQL", async () => {
    const old = await table("people", definition());
    const manual = await table("people", definition() + "\nTRIGGERS\n  custom trigger");
    const added = await table("notes", definition("notes"));
    const draft = generateMigration("postgres", release("v1", null, [old]), [manual, added]);
    expect(draft.issues).toHaveLength(1);
    expect(draft.issues[0].label).toBe("public.people");
    expect(draft.sql).toContain("CREATE TABLE");
  });
  test("creates sequences before tables and foreign keys after all new tables", async () => {
    const orders = await table("orders", definition("orders") + "\nCONSTRAINTS\norders_person_fk FOREIGN KEY (id) FOREIGN KEY (id) REFERENCES public.people(id)");
    const people = await table("people", definition());
    const sequence = { ...await table("people_ids", "SEQUENCE public.people_ids\n  data_type bigint\n  start 1\n  min 1\n  max 999999\n  increment 1\n  cycle NO"), object: { ...people.object, id: "people_ids", path: "database/objects/people_ids.sql", selection: { ...people.object.selection, objectType: "sequence" as const, objectName: "people_ids" } } };
    const draft = generateMigration("postgres", release("v1", null), [orders, sequence, people]);
    expect(draft.issues).toEqual([]);
    expect(draft.sql.indexOf("CREATE SEQUENCE")).toBeLessThan(draft.sql.indexOf("CREATE TABLE"));
    expect(draft.sql.indexOf('CREATE TABLE "public"."people"')).toBeLessThan(draft.sql.indexOf('ALTER TABLE "public"."orders" ADD CONSTRAINT'));
  });
  test("destructive migrations require explicit opt in", async () => {
    const old = await table("people", definition());
    expect(generateMigration("postgres", release("v1", null, [old]), []).issues).toHaveLength(1);
    expect(generateMigration("postgres", release("v1", null, [old]), [], true).sql).toBe('DROP TABLE "public"."people";');
    const changed = await table("people", definition().replace("\n  email text NULL", ""));
    expect(generateMigration("postgres", release("v1", null, [old]), [changed]).issues).toHaveLength(1);
    expect(generateMigration("postgres", release("v1", null, [old]), [changed], true).sql).toContain('DROP COLUMN "email"');
  });
  test("rejects extra SQL hidden in a new table default", async () => {
    const added = await table("people", definition() + "\n  bad text NULL DEFAULT 1; COMMIT;");
    const draft = generateMigration("postgres", release("v1", null), [added]);
    expect(draft.sql).toBe("");
    expect(draft.issues).toHaveLength(1);
  });
});

test("seeds require a development branch and insert-only SQL", () => {
  for (const branch of [null, "main", "MASTER", "HEAD", "production", "prod", "trunk"]) expect(seedBranchAllowed(branch)).toBe(false);
  expect(seedBranchAllowed("development")).toBe(true);
  expect(seedBranchAllowed("feature/invoices")).toBe(true);
  expect(seedStatementCount("INSERT INTO public.people (id) VALUES (1); INSERT INTO public.people (id) VALUES (2);", "postgres")).toBe(2);
  expect(() => seedStatementCount("INSERT INTO public.people (id) VALUES (1); DELETE FROM public.people;", "postgres")).toThrow();
  expect(() => seedStatementCount("INSERT INTO public.people (name) VALUES ('unfinished)", "postgres")).toThrow();
});
