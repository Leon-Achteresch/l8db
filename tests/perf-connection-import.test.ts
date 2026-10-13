import { expect, test } from "bun:test";
import {
  countExternalImport,
  parseDbeaverConfig,
  parseNavicatExport,
} from "../src/lib/connection-import";
import {
  CONNECTIONS,
  dbeaverFixture,
  navicatFixture,
  RETAINED_ROUNDS,
  RUNS,
  scenario,
} from "./fixtures/connection-import-perf";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("DBeaver import of 2,000 connections with encrypted credentials stays within budget", async () => {
  const fixture = await dbeaverFixture();
  const { candidates, resolved } = await scenario("connection-import-dbeaver", () =>
    parseDbeaverConfig(fixture.dataSources, fixture.credentials),
  );
  expect(candidates.filter((candidate) => candidate.skipReason)).toHaveLength(CONNECTIONS / 4);
  expect(candidates.filter((candidate) => candidate.duplicateOf)).toHaveLength(
    CONNECTIONS / 4 - CONNECTIONS / 20,
  );
  expect(resolved.summary.missingPassword).toBe(0);
  const selected = new Set(candidates.map((candidate) => candidate.index));
  const counting = await measureScenario(() => {
    for (let toggle = 0; toggle < 50; toggle++) {
      selected.delete(toggle);
      countExternalImport(candidates, selected, toggle % 2 ? "copy" : "skip");
    }
  }, RUNS);
  reportScenario("connection-import-count", { candidates: CONNECTIONS, toggles: 50, ...counting });
  expect(counting.p95Ms).toBeLessThan(50);
});

test("Navicat import of 2,000 connections batches legacy decryption into one request", async () => {
  const text = await navicatFixture();
  let requests = 0;
  let legacyValues = 0;
  const { candidates } = await scenario("connection-import-navicat", () =>
    parseNavicatExport(text, async (values) => {
      requests++;
      legacyValues += values.length;
      return values.map(() => "legacyPw123");
    }),
  );
  const parses = 1 + 2 + RUNS + RETAINED_ROUNDS;
  expect(requests).toBe(parses);
  expect(legacyValues).toBe(parses * (CONNECTIONS / 50));
  expect(candidates.filter((candidate) => candidate.password).length).toBe(
    candidates.filter((candidate) => !candidate.skipReason).length,
  );
});
