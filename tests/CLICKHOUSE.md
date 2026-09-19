# ClickHouse browser lab

Treibt die laufende l8db-UI im Browser gegen eine echte ClickHouse-Instanz (echter Rust-Adapter, kein Mock).

## 1. ClickHouse starten

```
docker run -d --name l8db-clickhouse -p 8124:8123 -p 9010:9000 \
  -e CLICKHOUSE_USER=l8db -e CLICKHOUSE_PASSWORD=l8db -e CLICKHOUSE_DB=shop \
  clickhouse/clickhouse-server:latest
```

## 2. Bridge starten (Rust-Adapter als HTTP-Dispatcher auf 127.0.0.1:27021)

```
cd src-tauri
L8DB_CLICKHOUSE_BROWSER=1 L8DB_E2E_CLICKHOUSE_URL='clickhouse://l8db:l8db@localhost:8124/shop' \
  cargo test --lib -- --ignored --nocapture clickhouse_browser_bridge
```

## 3. Vite + Proxy starten

```
bun run dev
bun scripts/clickhouse-browser-proxy.mjs
```

Der Proxy (Port 1421) spiegelt den Vite-Dev-Server, injiziert einen `__TAURI_INTERNALS__`-Shim,
der die DB-Kommandos an die Bridge weiterreicht, und legt eine ClickHouse-Verbindung in
`localStorage` an. `http://localhost:1421` öffnen.

## Großer Testdatensatz (bigdata)

`scripts/clickhouse-seed-bigdata.sql` legt die Datenbank `bigdata` an: `events_big` mit 20 Mio. Zeilen und
allen relevanten Typen (DateTime64, Decimal, Int128/UInt256, Enum, Array, Map, Tuple, Nested, IPv4/6, UUID,
MATERIALIZED-Spalte), dazu ReplacingMergeTree, Memory, Log, Materialized View, View, Dictionary und
`weird db`.`my table` mit Leerzeichen/Backticks/Umlauten in Namen. Laufzeit ca. 2 Minuten.

```
python3 -c "
import subprocess
for s in open('scripts/clickhouse-seed-bigdata.sql').read().split(';\n'):
    s = s.strip()
    if s: print(subprocess.run(['curl','-s','http://localhost:8124/?user=l8db&password=l8db&max_insert_threads=8&max_execution_time=1200','--data-binary',s],capture_output=True,text=True).stdout[:200])
"
```

Bridge dann mit `L8DB_E2E_CLICKHOUSE_URL='clickhouse://l8db:l8db@localhost:8124/bigdata'` starten; der Proxy legt die Verbindung auf `bigdata`.
