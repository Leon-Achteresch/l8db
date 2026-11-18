#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

nonce="$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
database="l8db_a46_$nonce"
password="a46_$nonce"
container=""
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -fv "$container" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
container="$(docker run -d --pull=never --hostname "l8db-a46-$nonce" --name "l8db-a46-$nonce" \
  -p '127.0.0.1::8123' -e CLICKHOUSE_USER=a46 -e CLICKHOUSE_PASSWORD="$password" \
  -e CLICKHOUSE_DB="$database" clickhouse/clickhouse-server:25.8)"
binding="$(docker port "$container" 8123/tcp)"
[[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]
port="${BASH_REMATCH[1]}"
ready=false
for _ in {1..30}; do
  if curl -fsS --max-time 1 --user "a46:$password" \
    "http://127.0.0.1:$port/?database=$database" --data-binary 'SELECT 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Isolated ClickHouse fixture did not become ready' >&2
  exit 1
fi

L8DB_A46_LOCAL_CLICKHOUSE_URL="clickhouse://a46:$password@127.0.0.1:$port/$database" \
  CARGO_BUILD_JOBS=2 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  "${1:-db::clickhouse::merge_context_tests}" -- --include-ignored --test-threads=1 --nocapture
