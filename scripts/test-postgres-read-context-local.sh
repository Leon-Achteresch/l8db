#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# = 1 ]]; then
  [[ "$1" = /* && -x "$1" ]]
elif [[ $# = 3 && "$1" = --a13 ]]; then
  [[ "$2" = /* && -x "$2" && "$3" = /* && -f "$3" ]]
else
  printf 'Usage: %s ABSOLUTE_RUST_TEST_BINARY | --a13 ABSOLUTE_CLI_BINARY ABSOLUTE_A13_SETUP_SQL\n' "$0" >&2
  exit 2
fi
bindir="$(pg_config --bindir)"
lab="$(mktemp -d "${TMPDIR:-/tmp}/l8db-a31-pg.XXXXXX")"
lab="$(cd "$lab" && pwd -P)"
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -f "$lab/data/postmaster.pid" ]]; then
    "$bindir/pg_ctl" -D "$lab/data" -m fast -w -t 15 stop >/dev/null || exit 1
  fi
  rm -rf -- "$lab"
  printf 'Private PostgreSQL cluster stopped and removed.\n'
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port="$(python3 - <<'PY'
import socket
with socket.socket() as server:
    server.bind(("127.0.0.1", 0))
    print(server.getsockname()[1])
PY
)"
owner="a31_$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
"$bindir/initdb" -D "$lab/data" -U "$owner" --locale=C --encoding=UTF8 \
  --auth-host=reject --auth-local=reject >"$lab/initdb.log"
cat >>"$lab/data/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = $port
unix_socket_directories = ''
max_connections = 8
shared_buffers = '16MB'
statement_timeout = '5s'
idle_in_transaction_session_timeout = '30s'
ssl = off
CONF
printf 'host postgres %s 127.0.0.1/32 trust\n' "$owner" >"$lab/data/pg_hba.conf"
"$bindir/pg_ctl" -D "$lab/data" -l "$lab/server.log" -w -t 15 start >/dev/null
cd "$lab"
url="postgresql://$owner@127.0.0.1:$port/postgres?sslmode=disable&connect_timeout=5"
psql_private() {
  env -i PATH=/usr/bin:/bin LC_ALL=C PGPASSFILE="$lab/pgpass" \
    "$bindir/psql" -X -qAtw -v ON_ERROR_STOP=1 --dbname "$url" "$@"
}
[[ "$(psql_private -c 'SHOW data_directory')" = "$lab/data" ]]
printf 'Private loopback PostgreSQL %s\n' "$(psql_private -c 'SHOW server_version')"

if [[ $# = 1 ]]; then
  psql_private -c 'CREATE TABLE public.a31_read_context (value integer NOT NULL); INSERT INTO public.a31_read_context VALUES (10)'
  python3 - "$bindir/psql" "$url" <<'PY'
import contextlib
import subprocess
import sys

def connect():
    return subprocess.Popen(
        [sys.argv[1], "-X", "-qAtw", "-v", "ON_ERROR_STOP=1", "--dbname", sys.argv[2]],
        env={"LC_ALL": "C", "PATH": "/usr/bin:/bin"},
        text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    )

def sql(session, statement):
    session.stdin.write(statement + "\n\\echo end_of_a31_result\n")
    session.stdin.flush()
    rows = []
    for line in session.stdout:
        if line.rstrip("\n") == "end_of_a31_result":
            return rows
        rows.append(line.rstrip("\n"))
    raise RuntimeError("PostgreSQL fixture closed before returning its result")

@contextlib.contextmanager
def sessions():
    first, second = connect(), connect()
    try:
        yield first, second
    finally:
        for session in (first, second):
            session.stdin.close()
            try:
                session.wait(timeout=5)
            except subprocess.TimeoutExpired:
                session.kill()
                session.wait()
            session.stdout.close()

with sessions() as (reader, writer):
    pid_reader, = sql(reader, "SELECT pg_backend_pid();")
    pid_writer, = sql(writer, "SELECT pg_backend_pid();")
    assert pid_reader != pid_writer
    sql(reader, "BEGIN ISOLATION LEVEL REPEATABLE READ;")
    assert sql(reader, "SELECT value FROM public.a31_read_context;") == ["10"]
    sql(writer, "BEGIN; UPDATE public.a31_read_context SET value = 20; COMMIT;")
    assert sql(writer, "SELECT value FROM public.a31_read_context;") == ["20"]
    assert sql(reader, "SELECT value FROM public.a31_read_context;") == ["10"]
    assert sql(reader, "SELECT pg_backend_pid();") == [pid_reader]
    sql(reader, "ROLLBACK;")
    assert sql(reader, "SELECT value FROM public.a31_read_context;") == ["20"]
    sql(writer, "BEGIN; UPDATE public.a31_read_context SET value = 30;")
    assert sql(writer, "SELECT value FROM public.a31_read_context;") == ["30"]
    assert sql(reader, "SELECT value FROM public.a31_read_context;") == ["20"]
    sql(writer, "ROLLBACK;")
    assert sql(writer, "SELECT value FROM public.a31_read_context;") == ["20"]
    assert sql(writer, "SELECT pg_backend_pid();") == [pid_writer]
    print("Two distinct, stable PostgreSQL sessions: 10 before commit, 10 in the explicitly chosen repeatable-read session, 20 after rollback, uncommitted 30 discarded.")
PY

  for test in \
    db::transaction::pg_row_tests::postgres_transaction_batches_return_the_first_result_set \
    db::transaction::table_tests::postgres_commits_only_selected_table; do
    env -i PATH=/usr/bin:/bin LC_ALL=C L8DB_SMOKE_POSTGRES_URL="$url" \
      "$1" "$test" --ignored --exact --test-threads=1 --nocapture
  done
else
  psql_private -f "$3"
  for zone in UTC Asia/Tokyo; do
    zoned_url="$url&options=-c%20TimeZone%3D${zone/\//%2F}"
    env -i PATH=/usr/bin:/bin LC_ALL=C L8DB_AUTOMATION_DB="$lab/automation.db" \
      "$2" --url "$zoned_url" --read-only -o json table rows public.a13_dst \
      --order-by id >"$lab/${zone//\//-}.json"
  done
  env -i PATH=/usr/bin:/bin LC_ALL=C L8DB_AUTOMATION_DB="$lab/automation.db" \
    "$2" --url "$url" --read-only -o json table describe public.a13_dst >"$lab/columns.json"
  python3 - "$lab" <<'PY'
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

lab = Path(sys.argv[1])
def read(name):
    return json.loads((lab / name).read_text())

columns = {r["column"]: r["type"] for r in read("columns.json")}
assert columns["event_at"] == "timestamp(6) with time zone", columns
assert columns["wall_time"] == "timestamp(6) without time zone", columns
assert columns["text_like"] == "text", columns
expected = [
    "2026-03-29T00:59:59.123456+00:00", "2026-03-29T01:00:00.234560+00:00",
    "2026-10-25T00:30:00.999999+00:00", "2026-10-25T01:30:00.000001+00:00",
]
for name, offset in [("UTC.json", 0), ("Asia-Tokyo.json", 9)]:
    rows = read(name)
    assert len(rows) == 5, rows
    for row, instant in zip(rows, expected):
        dt = datetime.strptime(row["event_at"], "%Y-%m-%dT%H:%M:%S.%f%z")
        assert dt.utcoffset().total_seconds() == offset * 3600, row
        assert dt.astimezone(timezone.utc) == datetime.fromisoformat(instant), row
    assert rows[1]["wall_time"] == "2026-03-29T02:30:00.123456", rows[1]
    assert rows[1]["text_like"] == "2026-03-29T01:00:00.234560+00:00", rows[1]
    assert all(rows[4][key] is None for key in ("event_at", "wall_time", "text_like"))
    print(f"Rust CLI adapter {name}: {columns['event_at']}, {columns['wall_time']}, 4 exact instants and NULL")
    print([row["event_at"] for row in rows])
PY
fi
