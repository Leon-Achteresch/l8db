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
