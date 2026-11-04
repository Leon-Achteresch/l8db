# Issue-Relay

Nimmt Fehlerberichte aus l8db an (KI-Chat-Tool und MCP-Tool `report_issue`) und legt sie als GitHub-Issue in `Leon-Achteresch/l8db` an. Geschwärzte Screenshots werden öffentlich gespeichert und im Issue eingebettet. Der Relay läuft wahlweise auf einem eigenen VPS mit lokalem Volume oder als Cloudflare-Worker mit R2. Ein separates GitHub-Assets-Repository ist nicht nötig. Nutzer brauchen kein GitHub-Konto.

## Eigener VPS mit Docker / Coolify

Diese Variante nutzt vorhandenen VPS-Speicher und braucht kein R2-Abonnement. Der Docker-Server läuft mit Node.js 24 und führt denselben Relay-Kern aus wie der Worker. Die Projekt-Toolchain und Bun-Tests bleiben bei Bun 1.3.10.

1. Die GitHub-App wie unten in Schritt 1–2 einrichten. Den PKCS#8-Schlüssel ausschließlich über SSH nach `/data/l8db-issue-relay/secrets/github-app.pem` übertragen. Verzeichnis mit Modus `0700`, Schlüssel mit Modus `0400`, lesbar für Container-UID `1000`. Keine Schlüssel ins Repository, Docker-Image oder über das unverschlüsselte Coolify-Dashboard übertragen.
2. Im Ordner `services/issue-relay` bauen: `docker build -t l8db-issue-relay:local .`. Für Updates einen neuen Tag aus dem Commit verwenden und `compose.yaml` entsprechend anpassen.
3. In Coolify einen Docker-Compose-Service mit `compose.yaml` erstellen. App-ID, Installations-ID und `PUBLIC_URL` an die eigene Einrichtung anpassen. Dem Service die HTTPS-Domain mit Zielport `3000` zuweisen. Der A-Record muss auf den VPS zeigen. Coolify/Traefik verwaltet TLS. Keinen direkten Host-Port freigeben.
4. `TRUST_PROXY=1` setzt genau einen vorgeschalteten Traefik-Proxy voraus: verwendet wird der letzte Eintrag im von Traefik ergänzten `X-Forwarded-For`. Vorgeschaltetes CDN oder weitere Proxy-Hops benötigen eine angepasste Vertrauenskonfiguration. Ohne Proxy `TRUST_PROXY` weglassen; dann zählt die Socket-IP. Vom Client gelieferte `CF-Connecting-IP`-Header werden immer ersetzt.
5. Das benannte Volume `screenshots` enthält unter `/data/screenshots` die PNGs; den Schlüssel separat sichern. Volume und Schlüssel bei Redeploys erhalten. Ein volles Volume verhindert neue Bilder, bestehende Issues bleiben erhalten.
6. Die HTTPS-URL ohne `/issues` als Repository-Variable `L8DB_ISSUE_RELAY_URL` setzen. Die nächste separat beauftragte Veröffentlichung übernimmt sie in die App. Dies löst selbst keinen Release aus.

`GET /health` prüft nur den HTTP-Prozess, keine GitHub-Zugangsdaten. Bilder liegen unter `/screenshots/<issue>-<uuid>.png`. Sie sind öffentlich und dürfen keine sensiblen Daten enthalten. Nur synthetische Daten für Live-Tests verwenden.

Grenzen: 4 MB pro Request, vier gleichzeitig verarbeitete Berichte, drei Berichte pro Minute/IP, maximal 4096 Rate-Limit-Einträge und 4096 Bilder beziehungsweise 512 MiB Bilddaten. Bei voller Rate-Limit-Tabelle werden neue IPs abgewiesen. Die In-Memory-Rate-Limits starten bei einem Neustart neu. Bilder verfallen nach 365 Tagen; physisch entfernt werden sie beim Start und beim nächsten Upload. Uploads haben eine feste Gesamtdauer von 15 Sekunden, auch wenn laufend weitere Bytes eintreffen. Unvollständige Dateien tragen `.pending`, werden nie ausgeliefert und vor Freigabe der Speicherreservierung gelöscht; bei fehlgeschlagener Bereinigung bleibt die gesamte Reservierung erhalten. Es gibt keine Bereinigungstimer, Datenbank oder Hintergrundabfragen. GitHub-Aufrufe haben jeweils 15 Sekunden Timeout und übernehmen den Abbruch des Requests.

Scoped Checks: `bun test tests/issue-relay.test.ts tests/issue-relay-self-hosted.test.ts` mit Bun 1.3.10. Der Leistungstest prüft 100 000 Client-Identitäten (4096 Einträge, Median < 1 ms, p95 < 2 ms, Heap-Zuwachs < 32 MiB), acht parallele Schreibvorgänge mit insgesamt 24 MB (< 3 s), Quoten, Abbruch und unveränderten Idle-Zustand. Der Worker-Dekodierungstest verarbeitet acht komplette Berichte mit je 2,9 MB PNG. Die Node-Tests laufen separat mit `node --test services/issue-relay/test/self-hosted.test.js`: gleiche acht Berichte bei vier parallelen Anfragen, p95 < 3 s, RSS-Zuwachs < 128 MiB und genau 24 gemockte GitHub-Aufrufe; dazu echte HTTP-Abbrüche, langsame Uploads und simulierte Schreib-/Bereinigungsfehler. Plattformmessungen stehen in `PERFORMANCE.md`.

## Cloudflare-Worker mit R2

1. GitHub-App anlegen (Settings → Developer settings → GitHub Apps), ohne Webhook. Einziges Recht: *Issues: Read & write*. Die App nur auf `l8db` installieren. App-ID und Installations-ID (aus der URL der Installation) notieren, einen Private Key erzeugen.
2. Den Schlüssel nach PKCS#8 umwandeln: `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem`.
3. Im Ordner `services/issue-relay` den Bucket anlegen und öffentlich machen:
   ```sh
   bunx wrangler r2 bucket create l8db-issue-screenshots
   bunx wrangler r2 bucket dev-url enable l8db-issue-screenshots
   ```
   Für den Betrieb eine eigene Domain an den Bucket hängen (R2 → Bucket → Settings → Custom Domains), die `r2.dev`-Adresse ist gedrosselt und nur zum Testen gedacht. Die Adresse in `wrangler.toml` bei `SCREENSHOT_BASE_URL` eintragen. Solange dort der Platzhalter steht, werden Issues ohne Bild angelegt.
   Alte Bilder automatisch löschen: `bunx wrangler r2 bucket lifecycle add l8db-issue-screenshots expire --expire-days 365`.
4. Secrets setzen und deployen:
   ```sh
   bunx wrangler secret put GITHUB_APP_ID
   bunx wrangler secret put GITHUB_INSTALLATION_ID
   bunx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem
   bunx wrangler deploy
   ```
5. Die ausgegebene Worker-URL (ohne `/issues`) als Repository-Variable `L8DB_ISSUE_RELAY_URL` hinterlegen. `release.yml` kompiliert sie in die App. Lokal geht das auch zur Laufzeit über die gleichnamige Umgebungsvariable.

## Schutz

- Höchstens 3 Berichte pro Minute und IP (`ratelimits`), Anfragen über 4 MB werden abgelehnt.
- Titel ≤ 200, Text ≤ 60 000 Zeichen, Screenshot nur als PNG.
- `@`-Erwähnungen werden entschärft, Labels sind fest (`bug`, `ai-report`).
- Die GitHub-App darf nur Issues schreiben, keinen Code.
- Erst wird das Issue angelegt, dann das Bild hochgeladen und verlinkt. Ohne Issue entstehen keine Bilder, und ein fehlgeschlagener Upload kostet nur das Bild, nicht den Bericht.
- Bekannte Grenze: Der Endpunkt hat keine Anmeldung, die URL steckt in der App. Wer sie ausliest, kann bis zu 3 Berichte pro Minute und IP anlegen. Bei Missbrauch die Grenze in `wrangler.toml` senken oder Cloudflare Turnstile davorschalten.
- Über MCP muss der Agent `confirm=true` setzen, nachdem der Nutzer Titel und Text gesehen hat. Über MCP gibt es keinen Screenshot, weil der Server ohne Fenster läuft.
- Die App schwärzt vor dem Senden alle Texte, Eingaben, Bilder und Canvas im Screenshot und filtert Zugangsdaten aus dem Text. Der Nutzer sieht die Vorschau und bestätigt jeden Bericht.
