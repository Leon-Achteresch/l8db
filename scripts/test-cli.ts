import { existsSync } from "node:fs";
import { resolve } from "node:path";

const binary = resolve(
  process.env.L8DB_BIN ??
    `src-tauri/target/debug/l8db${process.platform === "win32" ? ".exe" : ""}`,
);
const postgres = process.env.L8DB_CLI_TEST_PG_URL;
if (!existsSync(binary) || !postgres) {
  console.error(
    "CLI-Abnahme benötigt ein gebautes L8DB_BIN und L8DB_CLI_TEST_PG_URL für eine wegwerfbare PostgreSQL-Lab-Datenbank.",
  );
  process.exit(1);
}
const fixtures = Bun.spawn(
  [binary, "--url", postgres, "query", "--file", resolve("tests/lab/cli-fixtures.sql")],
  { stdout: "inherit", stderr: "inherit", env: process.env },
);
const prepared = await fixtures.exited;
if (prepared !== 0) process.exit(prepared);
const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "tests/cli-e2e.test.ts",
    "tests/automation-cli-e2e.test.ts",
    "tests/check-cli-e2e.test.ts",
    "tests/benchmark-cli-e2e.test.ts",
  ],
  {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      L8DB_BIN: binary,
      L8DB_CLI_E2E: "1",
      L8DB_AUTOMATION_E2E: "1",
      L8DB_CHECK_E2E: "1",
      L8DB_BENCHMARK_E2E: "1",
      L8DB_CLI_E2E_PG: postgres,
      L8DB_CLI_E2E_PG_PERF: postgres,
      L8DB_CHECK_DATABASE_URL: postgres,
      L8DB_BENCHMARK_PG_URL: postgres,
    },
  },
);
process.exit(await child.exited);
