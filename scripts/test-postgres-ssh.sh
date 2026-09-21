#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export L8DB_LAB_DIR
L8DB_LAB_DIR=$(mktemp -d "${TMPDIR:-/tmp}/l8db-lab.XXXXXX")
project="l8db-test-$(basename "$L8DB_LAB_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
compose=(docker compose -p "$project" -f tests/lab/compose.yml)
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then "${compose[@]}" logs --no-color || true; fi
  "${compose[@]}" down --volumes --remove-orphans || true
  rm -rf "$L8DB_LAB_DIR"
  exit "$result"
}
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -f "$L8DB_LAB_DIR/client"
chmod 644 "$L8DB_LAB_DIR/client.pub"
"${compose[@]}" up --build --wait --wait-timeout 120
pg_address=$("${compose[@]}" port postgres 5432)
ssh_address=$("${compose[@]}" port ssh 22)
export L8DB_E2E_PG_URL="postgresql://postgres:testpw@${pg_address}/testdb"
if [ "${L8DB_LAB_TEST_UNREACHABLE:-0}" = 1 ]; then
  L8DB_E2E_PG_URL="postgresql://postgres:testpw@127.0.0.1:1/testdb"
fi
export L8DB_SMOKE_POSTGRES_URL="$L8DB_E2E_PG_URL"
export L8DB_E2E_SSH_HOST=127.0.0.1
export L8DB_E2E_SSH_PORT="${ssh_address##*:}"
export L8DB_E2E_KEY_FILE="$L8DB_LAB_DIR/client"
export L8DB_KNOWN_HOSTS="$L8DB_LAB_DIR/known_hosts"
timing=(env)
if [ "${L8DB_MEASURE:-0}" = 1 ]; then
  if [ "$(uname)" = Darwin ]; then timing=(/usr/bin/time -l); else timing=(/usr/bin/time -v); fi
fi
for suite in postgres_commits_only_selected_table qol_csv_failure_rolls_back_all_rows qol_cancel_isolates_server_output_and_transaction_sessions db::ssh::tests::tunnel_ export_cursor_limits_ csv_conflict_ csv_stream_large_ snapshot_ compare_large_; do
  selected=$(cargo test --manifest-path src-tauri/Cargo.toml --locked --lib "$suite" -- --ignored --list)
  if ! printf '%s\n' "$selected" | grep -q ': test$'; then
    printf 'Required integration suite has no tests: %s\n' "$suite" >&2
    exit 1
  fi
  "${timing[@]}" cargo test --manifest-path src-tauri/Cargo.toml --locked --lib "$suite" -- --ignored --test-threads=1 --nocapture
done

if [ "${L8DB_BENCHMARK:-0}" = 1 ]; then
  if [ "$(uname)" = Darwin ]; then
    /usr/bin/time -l cargo test --manifest-path src-tauri/Cargo.toml --locked --lib export_cursor_benchmark -- --ignored --test-threads=1 --nocapture
  else
    /usr/bin/time -v cargo test --manifest-path src-tauri/Cargo.toml --locked --lib export_cursor_benchmark -- --ignored --test-threads=1 --nocapture
  fi
fi
