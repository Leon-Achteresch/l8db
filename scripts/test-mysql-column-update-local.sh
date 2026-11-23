#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

nonce="$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
database="l8db_a44_$nonce"
password="a44_$nonce"
container=""
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -fv "$container" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
container="$(docker run -d --pull=never --hostname "l8db-a44-$nonce" --name "l8db-a44-$nonce" \
  -p '127.0.0.1::3306' -e MYSQL_ROOT_HOST=% -e MYSQL_ROOT_PASSWORD="$password" \
  -e MYSQL_DATABASE="$database" mysql:8)"
binding="$(docker port "$container" 3306/tcp)"
[[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]
port="${BASH_REMATCH[1]}"
ready=false
for _ in {1..40}; do
  if docker exec -e MYSQL_PWD="$password" "$container" \
    mysql -h127.0.0.1 -uroot -D "$database" -e 'SELECT 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Isolated MySQL fixture did not become ready' >&2
  exit 1
fi

L8DB_A44_LOCAL_MYSQL_URL="mysql://root:$password@127.0.0.1:$port/$database?sslmode=disable" \
  CARGO_BUILD_JOBS=2 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  db::mysql::column_update_tests -- --include-ignored --test-threads=1 --nocapture
