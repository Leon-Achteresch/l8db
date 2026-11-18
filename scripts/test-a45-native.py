import http.client
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parent.parent


def part(source, start, end):
    offset = source.index(start)
    return source[offset:source.index(end, offset)]


def build(work, deps):
    db = ROOT / "src-tauri/src/db"
    influx = (db / "influxdb.rs").read_text()
    (work / "influxdb.rs").write_text(
        part(influx, "#[derive(Clone, Copy, PartialEq, Eq, Debug)]", "fn quote(")
        + part(influx, "fn flux_hint(", "fn is_influxql(")
        + part(influx, "impl InfluxAdapter {", "    async fn database(&self)") + "}\n"
    )
    (work / "http_api.rs").write_text((db / "http_api.rs").read_text().split("#[cfg(test)]", 1)[0])
    (work / "commands.rs").write_text(part(
        (db / "commands.rs").read_text(),
        "#[derive(serde::Serialize)]\n#[serde(untagged)]\npub enum DatabaseListResponse",
        "#[tauri::command]\npub async fn list_schemas",
    ))
    command = [
        "rustc", "--edition=2021", "-C", "debuginfo=0",
        str(ROOT / "scripts/a45-native-host.rs"), "-L", f"dependency={deps}",
        "-o", str(work / "a45-native"),
    ]
    cached = {
        "serde": "960abb8658a1581e",
        "serde_json": "877b54b457c90f14",
        "url": "c532990cc46258ed",
        "reqwest": "a43679a6b5781f4d",
        "tauri": "b6d60d775e97639e",
        "tokio": "010ec27775c97e3e",
    }
    for name, suffix in cached.items():
        library = deps / f"lib{name}-{suffix}.rlib"
        if not library.is_file():
            raise FileNotFoundError(f"Missing cached A36 dependency: {library.name}")
        command += ["--extern", f"{name}={library}"]
    subprocess.run(command, check=True, cwd=ROOT, env={
        **os.environ,
        "A45_NATIVE_SOURCE": str(work),
        "CARGO_PKG_NAME": "a45-native-fixture",
        "CARGO_MANIFEST_DIR": str(work),
    })
    subprocess.run(
        ["bun", "--no-env-file", "-e", """
import { build } from "vite";
import { arrayEditorViteConfig } from "./scripts/array-editor-vite";
await build({
  ...arrayEditorViteConfig(),
  base: "./",
  build: {
    outDir: process.env.A45_NATIVE_ASSET_DIR,
    rollupOptions: { input: "tests/fixtures/influx-bucket-retention.html" },
  },
});
"""],
        cwd=ROOT, check=True, env={**os.environ, "A45_NATIVE_ASSET_DIR": str(work / "assets")},
    )
    print("Native host linked from cached Rust libraries with the regular React bucket picker", flush=True)


def terminate(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def exercise(work, influxd):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    operator = secrets.token_hex(32)

    def request(method, path, token=None, data=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Token " + token
        try:
            conn.request(method, path, json.dumps(data) if data is not None else None, headers)
            resp = conn.getresponse()
            return resp.status, json.loads(resp.read())
        finally:
            conn.close()

    def create(path, data, token=operator):
        status, body = request("POST", path, token, data)
        if status != 201:
            raise RuntimeError(f"Fixture setup {path}: HTTP {status}")
        return body

    host = server = None
    with (work / "server.log").open("wb") as server_log:
        try:
            server = subprocess.Popen([
                str(influxd), "--reporting-disabled", "--http-bind-address", f"127.0.0.1:{port}",
                "--bolt-path", str(work / "fixture.bolt"), "--engine-path", str(work / "engine"),
                "--sqlite-path", str(work / "fixture.sqlite"),
            ], cwd=work, stdout=server_log, stderr=subprocess.STDOUT,
                env={"PATH": "/usr/bin:/bin", "TMPDIR": str(work)})
            for _ in range(100):
                if server.poll() is not None:
                    raise RuntimeError(f"Isolated influxd exited with {server.returncode}")
                own_listener = subprocess.run([
                    "/usr/sbin/lsof", "-n", "-P", "-a", "-p", str(server.pid),
                    f"-iTCP:{port}", "-sTCP:LISTEN",
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if own_listener.returncode == 0:
                    status, health = request("GET", "/health")
                    if status == 200 and health["status"] == "pass":
                        break
                time.sleep(0.15)
            else:
                raise RuntimeError("Isolated InfluxDB readiness failed")
            assert health["version"].lstrip("v") == "2.10.1"
            for _ in range(100):
                status, setup = request("GET", "/api/v2/setup")
                if status != 503:
                    break
                time.sleep(0.15)
            assert status == 200 and setup["allowed"] is True
            alpha = create("/api/v2/setup", {
                "username": "a45-native-fixture", "password": secrets.token_hex(16),
                "org": "alpha", "bucket": "metrics", "retentionPeriodSeconds": 604801,
                "token": operator,
            }, token=None)
            beta = create("/api/v2/orgs", {"name": "beta"})
            beta_bucket = create("/api/v2/buckets", {
                "orgID": beta["id"], "name": "metrics",
                "retentionRules": [{"type": "expire", "everySeconds": 0}],
            })

            def reader(org):
                return create("/api/v2/authorizations", {
                    "orgID": org, "description": "A45 native fixture reader",
                    "permissions": [{"action": "read", "resource": {"type": "buckets", "orgID": org}}],
                })["token"]

            alpha_token, beta_token = reader(alpha["org"]["id"]), reader(beta["id"])
            connections = []
            for label, token, selector in [
                ("alpha", alpha_token, {"org": "alpha"}),
                ("beta", beta_token, {"orgID": beta["id"]}),
                ("missing-scope", alpha_token, {}),
            ]:
                params = urlencode({"version": "2", "token": token, **selector})
                connections.append({
                    "id": label, "kind": "influxdb", "name": label, "sslMode": "disable",
                    "connectionString": f"influxdb://127.0.0.1:{port}/metrics?{params}",
                })
            (work / "connections.json").write_text(json.dumps(connections))
            print(
                f"Own OSS {health['version']} loopback instance {server.pid}; "
                f"alpha {alpha['org']['id']}/{alpha['bucket']['id']}; "
                f"beta {beta['id']}/{beta_bucket['id']}",
                flush=True,
            )
            host = subprocess.Popen([str(work / "a45-native")], cwd=work, env={
                "PATH": "/usr/bin:/bin", "TMPDIR": str(work), "A45_NATIVE_DATA": str(work),
            })
            print(f"Own Tauri/WKWebView host PID {host.pid}", flush=True)
            return host.wait()
        finally:
            terminate(host)
            terminate(server)
            print("Private host and InfluxDB fixture stopped", flush=True)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: test-a45-native.py CACHED_CARGO_DEBUG_DEPS INFLUXD_2_10_1")
    deps, influxd = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda signum, _: sys.exit(128 + signum))
    with tempfile.TemporaryDirectory(prefix="l8db-a45-native.") as location:
        work = Path(location)
        build(work, deps)
        return exercise(work, influxd)


if __name__ == "__main__":
    sys.exit(main())
