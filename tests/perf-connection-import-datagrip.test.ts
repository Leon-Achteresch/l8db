import { expect, test } from "bun:test";
import { parseDataGripConfig, persistImportedSecrets } from "../src/lib/connection-import";
import {
  CONNECTIONS,
  datagripFixture,
  SECRET_CONCURRENCY,
  scenario,
} from "./fixtures/connection-import-perf";
import { reportScenario } from "./fixtures/usage-performance";

test("DataGrip import of 2,000 data sources stays within budget", async () => {
  const files = datagripFixture();
  const { candidates } = await scenario("connection-import-datagrip", async () =>
    parseDataGripConfig(files),
  );
  expect(candidates.filter((candidate) => candidate.profile?.ssh)).toHaveLength(
    candidates.filter((candidate) => !candidate.skipReason && candidate.index % 5 === 0).length,
  );
});

test("storing 2,000 imported secrets keeps keychain concurrency bounded", async () => {
  const secrets = Array.from({ length: CONNECTIONS }, (_, index) => ({
    id: `id-${index}`,
    password: `pw-${index}`,
    sshSecret: index % 5 === 0 ? `ssh-${index}` : null,
    proxySecret: null,
  }));
  let active = 0;
  let peak = 0;
  let calls = 0;
  const started = performance.now();
  const failed = await persistImportedSecrets(
    secrets,
    async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    },
    { ssh: (id) => `${id}:ssh`, proxy: (id) => `${id}:proxy` },
    SECRET_CONCURRENCY,
  );
  const elapsedMs = performance.now() - started;
  reportScenario("connection-import-secrets", { secrets: calls, peak, elapsedMs });
  expect(failed).toBe(0);
  expect(calls).toBe(CONNECTIONS + CONNECTIONS / 5);
  expect(peak).toBeLessThanOrEqual(SECRET_CONCURRENCY);
  expect(active).toBe(0);
  expect(elapsedMs).toBeLessThan(250);
});
