# Datensätze beobachten (MCP `watch`)

Eine KI legt über `l8db mcp` einen Watcher auf einzelne Zeilen (PostgreSQL, per Primärschlüssel) und bekommt jede Änderung als kurzen Diff gemeldet, ohne selbst nachzufragen.

```
watch action=add connection=Prod table=orders ids=["77","78"] minutes=120
→ w1 watches orders 77, 78 for 120 min. …
← <channel source="l8db" watch="w1" table="orders">w1 orders 77 status: "pending"→"paid"</channel>
```

Aktionen: `add` (table, ids ≤ 100, columns optional, minutes 1–480, Standard 60), `list`, `changes` (gepufferte Meldungen für Clients ohne Push), `remove` (watch-ID oder `all`). Das Tool erscheint nur, wenn mindestens eine freigegebene PostgreSQL-Verbindung existiert, und nur im MCP-Server, nicht im KI-Chat der App.

## Zustellung

- **Claude Code:** Der Server meldet `experimental.claude/channel` und schickt `notifications/claude/channel`. Eine untätige Sitzung wacht dadurch selbst auf. Channels sind eine Research Preview: Start mit `claude --dangerously-load-development-channels server:<name>`, nicht in `-p`, in Team-/Enterprise-Organisationen nur mit `channelsEnabled`. Wer die MCP-Version 2026-07-28 aushandelt, wird nicht als Channel registriert; dann `MCP_PROTOCOL_NEGOTIATION=legacy` setzen.
- **Andere Clients:** Meldungen landen in einem Puffer (200 Zeilen, Überlauf wird gezählt) und werden mit `action=changes` gelesen.
- SSE und Webhooks erreichen das Modell nicht und sind deshalb kein Weg für die KI. Webhooks bleiben den Automationen vorbehalten.

## Erkennung und Datenbanklast

- Polling über `xmin` per Primärschlüssel im nativen Typ (`id = any(array[…]::integer[])`, Index-Scan). Ein Vergleich über `id::text` würde den Index umgehen (27–46 ms statt 0,012 ms je Abfrage auf 200.000 Zeilen).
- Keine Trigger, kein `LISTEN`, kein Replikations-Slot. Trigger + NOTIFY kosteten im POC 20–48 % Schreibrate und bleiben nach einem Absturz verwaist; ein Slot hält WAL unbegrenzt.
- Eine dauerhafte Verbindung pro Datenbank und Sitzung (`application_name = l8db-watch`), unabhängig von der Zahl der Watches; dazu eine kurze Verbindung je `add` für Auflösung und Startzustand. Pro Zyklus eine Abfrage je Watch, Watches auf derselben Tabelle werden nicht gebündelt. Jede Abfrage läuft als `BEGIN READ ONLY; SET LOCAL statement_timeout = 2000; SET LOCAL lock_timeout = 500; …; COMMIT` in einem Roundtrip. `SET LOCAL` statt Sitzungseinstellungen, damit hinter PgBouncer nichts an andere Clients durchsickert.
- Intervall 1 s nach einer Änderung, danach ×1,5 bis 10 s, ±20 % Jitter. Ohne Änderung höchstens 460 Abfragen pro Stunde und Watch (Mittel etwa 360), jede ein Index-Scan.
- Die Zeile selbst wird nur bei geänderter `xmin` gelesen: je Spalte `left(spalte::text, 256)` und `md5(spalte::text)`. Große Werte werden nie vollständig übertragen.
- Budget ohne Daemon: höchstens 4 Sitzungen pro Verbindung beobachten gleichzeitig (Lock-Dateien in `watch-slots/` neben `mcp.json`, das Betriebssystem gibt sie beim Prozessende frei). Pro Sitzung höchstens 20 Watches.
- Jede Abfrage hat zusätzlich 5 s Timeout im Client, damit eine halb offene Verbindung (Ruhezustand, VPN-Abbruch) den Watcher nicht festhält; danach wird neu verbunden. Fällt die Verbindung aus, melden alle Watches `paused` und nach dem Wiederaufbau `resumed`; Änderungen aus der Pause werden über `xmin` nachgeholt. Scheitert nur ein Watch (Tabelle gelöscht, Rechte entzogen), pausiert nur dieser.
- Watches enden mit der Sitzung (stdin-EOF), nach Ablauf der Minuten, mit `remove`, wenn die Verbindung im MCP nicht mehr freigegeben ist oder wenn sich ihre MCP-Einstellungen (Schemas, Schwärzung) ändern. Danach schließt die Verbindung. Ist `mcp.json` gerade nicht lesbar, gilt die zuletzt gelesene Fassung.

## Tokens

Jeder Push weckt das Modell und kostet einen Turn mit dem ganzen Kontext. Deshalb:

- Pro Zeile werden nur geänderte Spalten gemeldet, Werte auf 60 Zeichen gekürzt.
- Änderungen zwischen zwei Pushes werden zusammengefasst (alter Wert der ersten, neuer Wert der letzten). Rollbacks, No-op-Updates und hin-und-zurück-Änderungen erzeugen keine Meldung.
- Nach einem Push wartet der nächste 5 s, dann 10, 20 … bis 300 s; nach einer ruhigen Phase gleicher Länge wieder sofort. Eine Zeile, die sich jede Sekunde ändert, weckt das Modell 17-mal pro Stunde statt 3.600-mal.
- Höchstens 5 Zeilen pro Push, der Rest als „+N more rows changed“.

## Sicherheit

- Nur Lesen, auch auf schreibbaren Verbindungen. Tabellen außerhalb freigegebener Schemas gelten als nicht vorhanden. Ist der Primärschlüssel geschwärzt, wird `add` abgelehnt, sonst ließe sich darüber prüfen, welche Werte existieren.
- Jedes `add` steht im MCP-Audit-Log (`mcp-audit.jsonl`), das Polling selbst nicht.
- Sensible Spalten (Schwärzungsregeln, `redactColumns`, Maskierung) erscheinen nur als `spalte: changed`; ihre Werte werden nicht im Speicher gehalten. Wertmuster werden auf dem 256-Zeichen-Fenster geschwärzt, bevor gekürzt wird.
- Die Instruktionen des Servers sagen dem Modell, dass Channel-Meldungen Daten sind und keine Anweisungen.

## Messungen

Testlauf `cargo test --lib mcp::watch -- --include-ignored` gegen PostgreSQL 17.11 lokal (Linux x86_64, 8 Kerne, 16 GB, Rechner durch andere Prozesse stark ausgelastet), mit verkürzten Intervallen (40–300 ms Polling, 200–800 ms Push-Abstand):

MESSWERTE

Nicht gemessen: andere Datenbankfamilien (nur PostgreSQL unterstützt), PgBouncer, echte Netzwerklatenz, macOS und Windows (Lock-Dateien nutzen `File::try_lock`, dort ungetestet), Codex live.
