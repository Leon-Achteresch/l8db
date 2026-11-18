#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" -le 1 ] || { printf 'Only one explicit mode is accepted.\n' >&2; exit 2; }
mode=${1:---test}
if [ "$mode" = --editor ] || [ "$mode" = --routine ]; then
  command -v bun >/dev/null
  [ "$(bun --version)" = 1.3.10 ] || { printf 'Use Bun1.3.10 for the editor launcher.\n' >&2; exit 2; }
fi
case "$mode" in --test|--editor|--editor-test|--routine|--routine-test|--paging-test|--index-progress-test|--index-observation-test) ;; *) printf 'Usage: %s [--test|--editor|--editor-test|--routine|--routine-test|--paging-test|--index-progress-test|--index-observation-test]\n' "$0" >&2; exit 2 ;; esac
for tool in initdb pg_ctl createdb python3 cargo; do
  command -v "$tool" >/dev/null || { printf 'Required local tool missing: %s\n' "$tool" >&2; exit 1; }
done
lab=$(mktemp -d "${TMPDIR:-/tmp}/l8db-a01-pg.XXXXXX")
cleanup() {
  result=$?
  trap - EXIT
  if [ -f "$lab/data/postmaster.pid" ]; then pg_ctl -D "$lab/data" -m fast -w stop >/dev/null || result=1; fi
  if [ "$result" -ne 0 ]; then tail -60 "$lab/server.log" 2>/dev/null || true; fi
  rm -rf "$lab"
  printf 'Own cluster and temp directory removed: %s\n' "$lab"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
port=$(python3 - <<'PY'
import socket
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    print(s.getsockname()[1])
PY
)
nonce=$(python3 -c 'import secrets; print(secrets.token_hex(6))')
database="l8db_a01_$nonce"
initdb -D "$lab/data" -U l8db_a01 --encoding=UTF8 --locale=C --auth-local=trust --auth-host=reject >"$lab/initdb.log"
cat >>"$lab/data/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = $port
unix_socket_directories = ''
ssl = off
max_connections = 12
shared_buffers = '16MB'
cluster_name = '$database'
EOF
printf 'host all l8db_a01 127.0.0.1/32 trust\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n' >"$lab/data/pg_hba.conf"
pg_ctl -D "$lab/data" -l "$lab/server.log" -w -t 15 start >/dev/null
touch "$lab/pgpass" "$lab/pg_service.conf"
chmod 600 "$lab/pgpass" "$lab/pg_service.conf"
env -i PATH="$PATH" LC_ALL=C PGPASSFILE="$lab/pgpass" PGSERVICEFILE="$lab/pg_service.conf" PGCONNECT_TIMEOUT=5 PGSSLMODE=disable \
  createdb -h 127.0.0.1 -p "$port" -U l8db_a01 "$database"
export L8DB_A01_LOCAL_PG_URL="postgresql://l8db_a01@127.0.0.1:$port/$database?sslmode=disable"
export L8DB_A01_LOCAL_OWNED_DB="$database"
export L8DB_A01_LOCAL_OWNED_DIR="$lab"
printf '%s' "$database" >"$lab/a01-owner"
export CARGO_BUILD_JOBS=2
if [ "$mode" = --editor ] || [ "$mode" = --routine ]; then
  command -v bun >/dev/null
  cargo build --manifest-path src-tauri/Cargo.toml --locked --bin l8db
  bun --no-env-file scripts/run-array-editor-development.ts "$mode"
  exit
fi
if [ "$mode" = --index-observation-test ]; then
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
    db::postgres_health -- --test-threads=2 --include-ignored --nocapture
  exit
fi
if [ "$mode" = --index-progress-test ]; then
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
    db::postgres::session_monitor -- --test-threads=2 --include-ignored --nocapture
  exit
fi
if [ "$mode" = --paging-test ]; then
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
    db::postgres::page_live_tests::a21_postgres_table_paging \
    -- --exact --ignored --test-threads=2 --nocapture
  exit
fi
if [ "$mode" = --routine-test ]; then
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib routine_result_development::tests::routine_development_provider_contract \
    -- --exact --ignored --test-threads=1 --nocapture
  exit
fi
if [ "$mode" = --editor-test ]; then
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib array_editor_development::tests::isolated_fixture_editor_contract \
    -- --exact --ignored --test-threads=1 --nocapture
  exit
fi
mkdir -p test-artifacts
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
  db::postgres::arrays::live_tests::a01_local_postgresql_provider_roundtrip \
  -- --exact --ignored --test-threads=1 --nocapture | tee test-artifacts/a01-local-postgresql.log
grep -q '1 passed' test-artifacts/a01-local-postgresql.log
printf 'Own PostgreSQL cluster/database will now be stopped and removed.\n'
