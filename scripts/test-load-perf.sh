#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="${L8DB_LOAD_PERF_CONTAINER:-l8db-load-perf-$$}"
port="${L8DB_LOAD_PERF_PORT:-15499}"
tables="${L8DB_LOAD_PERF_TABLES:-3000}"
big_rows="${L8DB_LOAD_PERF_BIG_ROWS:-2000000}"
cleanup() {
  result=$?
  docker rm -f -v "$name" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT

docker run -d --name "$name" -p "127.0.0.1:$port:5432" -e POSTGRES_PASSWORD=testpw \
  "${L8DB_POSTGRES_IMAGE:-postgres:18}" -c max_locks_per_transaction=256 >/dev/null
for _ in $(seq 1 120); do
  docker exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

psql() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -q -U postgres -h 127.0.0.1 "$@"; }
psql -c "CREATE DATABASE l8db_perf" -c "CREATE DATABASE l8db_small"
psql -d l8db_perf <<SQL
SELECT format(
  'CREATE TABLE public.t_%s (id serial PRIMARY KEY, %s)',
  n,
  (SELECT string_agg(format('c%s %s', c, CASE c % 4 WHEN 0 THEN 'text' WHEN 1 THEN 'integer' WHEN 2 THEN 'numeric(12,2)' ELSE 'timestamptz' END), ', ') FROM generate_series(1, 20) c)
) FROM generate_series(1, $tables) n
\gexec
SELECT format('CREATE VIEW public.v_%s AS SELECT id, c1, c2 FROM public.t_%s', n, n) FROM generate_series(1, 400) n
\gexec
SELECT format('CREATE FUNCTION public.f_%s(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS %L', n, 'SELECT x + ' || n) FROM generate_series(1, 500) n
\gexec
SELECT format('CREATE PROCEDURE public.p_%s(x integer) LANGUAGE sql AS %L', n, 'SELECT x') FROM generate_series(1, 100) n
\gexec
SELECT format('CREATE SEQUENCE public.s_%s', n) FROM generate_series(1, 200) n
\gexec
INSERT INTO public.t_1 (c1, c2, c3, c4) SELECT i, i * 1.5, now(), 'row ' || i FROM generate_series(1, 500) i;
CREATE TABLE public.big (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL,
  t1_id integer REFERENCES public.t_1 (id)
);
INSERT INTO public.big
SELECT i, md5(i::text), (i % 1000) + 0.5, timestamptz '2026-01-01' + i * interval '1 second', NULL
FROM generate_series(1, $big_rows) i;
ANALYZE;
SQL

base="postgresql://postgres:testpw@127.0.0.1:$port"
L8DB_PERF_PG_URL="$base/l8db_perf" L8DB_GUARD_PG_URL="$base/l8db_small" \
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib load_perf_tests -- \
  --ignored --test-threads=1 --nocapture
