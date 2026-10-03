#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="${L8DB_POCKETBASE_VERSION:-0.30.0}"
port="${L8DB_POCKETBASE_PORT:-18090}"
endpoint="http://127.0.0.1:$port"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin_arm64 ;;
  Darwin-x86_64) platform=darwin_amd64 ;;
  Linux-aarch64 | Linux-arm64) platform=linux_arm64 ;;
  Linux-x86_64) platform=linux_amd64 ;;
  *) echo "Unsupported platform" >&2; exit 1 ;;
esac
cache="${L8DB_POCKETBASE_CACHE:-${TMPDIR:-/tmp}/l8db-pocketbase-$version}"
binary="$cache/pocketbase"
if [ ! -x "$binary" ]; then
  mkdir -p "$cache"
  curl -sSfL -o "$cache/pocketbase.zip" \
    "https://github.com/pocketbase/pocketbase/releases/download/v$version/pocketbase_${version}_$platform.zip"
  unzip -oq "$cache/pocketbase.zip" pocketbase -d "$cache"
fi
lab=$(mktemp -d "${TMPDIR:-/tmp}/l8db-pocketbase.XXXXXX")
server=""
cleanup() {
  result=$?
  if [ -n "$server" ]; then kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; fi
  rm -rf "$lab"
  exit "$result"
}
trap cleanup EXIT
email=lab@l8db.test
password=l8db-lab-password
"$binary" superuser upsert "$email" "$password" --dir "$lab/data" >/dev/null
"$binary" serve --http="127.0.0.1:$port" --dir "$lab/data" >"$lab/server.log" 2>&1 &
server=$!
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "$endpoint/api/health" && break
  sleep 0.5
done
json() {
  python3 -c "import json,sys; print(json.load(sys.stdin)$1)"
}
token=$(curl -sSf -X POST "$endpoint/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"identity\":\"$email\",\"password\":\"$password\"}" | json "['token']")
collection=$(curl -sSf -X POST "$endpoint/api/collections" -H "Authorization: $token" \
  -H 'Content-Type: application/json' --data-binary '{
    "name": "documents",
    "type": "base",
    "listRule": null,
    "viewRule": null,
    "fields": [
      {"name": "title", "type": "text", "required": true},
      {"name": "secret_note", "type": "text", "hidden": true},
      {"name": "attachment", "type": "file", "maxSelect": 1, "maxSize": 1048576, "protected": true}
    ]
  }' | json "['id']")
printf 'Protected l8db lab file\n' >"$lab/report.txt"
record=$(curl -sSf -X POST "$endpoint/api/collections/$collection/records" -H "Authorization: $token" \
  -F title=Report -F secret_note=hidden -F "attachment=@$lab/report.txt;type=text/plain")
record_id=$(printf '%s' "$record" | json "['id']")
filename=$(printf '%s' "$record" | json "['attachment']")
cd src-tauri
L8DB_E2E_POCKETBASE_URL="$endpoint" L8DB_E2E_POCKETBASE_TOKEN="$token" \
  L8DB_E2E_POCKETBASE_COLLECTION_ID="$collection" L8DB_E2E_POCKETBASE_RECORD_ID="$record_id" \
  L8DB_E2E_POCKETBASE_FILENAME="$filename" \
  cargo test --lib pocketbase::tests::live_lab_reads_collection_records_and_protected_file \
  -- --ignored --exact --test-threads=1 --nocapture
