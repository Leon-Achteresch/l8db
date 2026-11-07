#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"
setup_only=false
if [[ "${1:-}" == --setup-only ]]; then
  setup_only=true
elif [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--setup-only]\n' "$0" >&2
  exit 2
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  docker_cmd=(sudo -n docker)
fi
lab_name=l8db-rexa-spacetime
lab_image=clockworklabs/spacetime@sha256:1a45cf90808d463a7636ab684c067df10ce3c3156e1a21cad56eee7a98100f2f
lab_port="${L8DB_SPACETIME_LAB_PORT:-13000}"
lab_config="${L8DB_SPACETIME_LAB_CONFIG:-${TMPDIR:-/tmp}/l8db-spacetimedb-live.json}"
fixture_target="${XDG_CACHE_HOME:-$HOME/.cache}/l8db-rexa-spacetime-target"
fixture_wasm="$fixture_target/wasm32-unknown-unknown/release/l8db_spacetimedb_fixture.wasm"
if [[ ! "$lab_port" =~ ^[0-9]+$ ]] || ((lab_port < 1024 || lab_port > 65535)); then
  printf 'Invalid local SpacetimeDB port\n' >&2
  exit 2
fi
if [[ ! -f "$fixture_wasm" || tests/lab/spacetime/src/lib.rs -nt "$fixture_wasm" || tests/lab/spacetime/Cargo.toml -nt "$fixture_wasm" ]]; then
  CARGO_BUILD_JOBS=2 CARGO_TARGET_DIR="$fixture_target" cargo build \
    --manifest-path tests/lab/spacetime/Cargo.toml --locked --release --target wasm32-unknown-unknown
fi
if "${docker_cmd[@]}" inspect "$lab_name" >/dev/null 2>&1; then
  bound_port="$("${docker_cmd[@]}" inspect --format '{{(index (index .HostConfig.PortBindings "3000/tcp") 0).HostPort}}' "$lab_name")"
  bound_ip="$("${docker_cmd[@]}" inspect --format '{{(index (index .HostConfig.PortBindings "3000/tcp") 0).HostIp}}' "$lab_name")"
  if [[ "$bound_port" != "$lab_port" || "$bound_ip" != 127.0.0.1 ]]; then
    printf 'Existing %s must bind 127.0.0.1:%s; preserving it unchanged\n' "$lab_name" "$lab_port" >&2
    exit 1
  fi
  "${docker_cmd[@]}" start "$lab_name" >/dev/null
else
  "${docker_cmd[@]}" run -d --name "$lab_name" --memory 2g --memory-swap 2g --cpus 2 \
    -p "127.0.0.1:$lab_port:3000" "$lab_image" \
    start --in-memory --page_pool_max_size 536870912 >/dev/null
fi
server_version="$("${docker_cmd[@]}" run --rm "$lab_image" --version)"
python3 - "$lab_port" "$lab_config" "$fixture_wasm" "$server_version" <<'PY'
import json
import os
import pathlib
import stat
import sys
import time
import urllib.error
import urllib.request

port, config_path, wasm_path, version = sys.argv[1:]
version = next((line for line in version.splitlines() if line.startswith("spacetimedb tool version ")), version)
base = f"http://127.0.0.1:{port}"
database = "l8db-rexa-live"
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(method, path, body=None, token=None, content_type=None):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(base + path, body, headers, method=method)
    with client.open(req, timeout=30) as response:
        return response.status, response.read()

for attempt in range(100):
    try:
        request("GET", "/v1/ping")
        break
    except (OSError, urllib.error.URLError):
        if attempt == 99:
            raise RuntimeError("Local SpacetimeDB did not become ready") from None
        time.sleep(0.1)

config = None
path = pathlib.Path(config_path)
if path.exists():
    if path.is_symlink() or stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise RuntimeError("Existing lab credential file must be private and not a symlink")
    prior = json.loads(path.read_text())
    if prior.get("base") == base:
        try:
            request("GET", f"/v1/identity/{prior['identity']}/verify", token=prior["token"])
            config = prior
        except urllib.error.HTTPError:
            pass
if config is None:
    _, body = request("POST", "/v1/identity", b"")
    identity = json.loads(body)
    config = dict(base=base, database=database, token=identity["token"], identity=identity["identity"], serverVersion=version)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(config, output)
        output.write("\n")
token = config["token"]
request("PUT", f"/v1/database/{database}", pathlib.Path(wasm_path).read_bytes(), token, "application/wasm")
request("POST", f"/v1/database/{database}/call/seed", b"[10000]", token, "application/json")
for table in ("customer", "orders"):
    _, body = request("POST", f"/v1/database/{database}/sql", f"SELECT COUNT(*) AS n FROM {table}".encode(), token, "text/plain")
    count = json.loads(body)[0]["rows"][0][0]
    if count != 10000:
        raise RuntimeError(f"Expected 10000 rows in {table}, got {count}")
print(f"SpacetimeDB fixture ready: {base}/{database}; 10000 customers + 10000 orders; {version}")
print(f"Private credentials: {path}")
PY
if [[ "$setup_only" == false ]]; then
  L8DB_SPACETIME_LAB_CONFIG="$lab_config" CARGO_BUILD_JOBS=2 cargo test \
    --manifest-path src-tauri/Cargo.toml --locked --lib \
    db::spacetimedb::live_tests::live_spacetime_account_adapter_limits_performance_cancel_and_idle \
    -- --ignored --nocapture --test-threads=1
fi
