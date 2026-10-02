import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

export const PSQL = process.env.L8DB_PSQL ?? "/opt/homebrew/opt/postgresql@18/bin/psql";

export function postgresUrl(database: string): string {
  const user = encodeURIComponent(process.env.PGUSER ?? userInfo().username);
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : "";
  const host = process.env.PGHOST ?? "localhost";
  const port = process.env.PGPORT ?? "5432";
  return `postgres://${user}${password}@${host}:${port}/${database}?sslmode=disable`;
}

function psql(database: string, ...args: string[]): string {
  return execFileSync(PSQL, ["-d", database, "-v", "ON_ERROR_STOP=1", "-Atq", ...args], {
    encoding: "utf8",
  });
}

export function ensureSeeded(database: string, probe: string, seed: string) {
  const exists = psql(
    "postgres",
    "-c",
    `select 1 from pg_database where datname = '${database.replace(/'/g, "''")}'`,
  );
  if (!exists.trim()) psql("postgres", "-c", `create database "${database.replace(/"/g, '""')}"`);
  if (psql(database, "-c", `select to_regclass('${probe}') is not null`).trim() === "t") return;
  psql(database, "-f", seed);
}
