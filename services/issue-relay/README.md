# Issue-Relay

Nimmt Fehlerberichte aus l8db an (KI-Chat-Tool und MCP-Tool `report_issue`) und legt sie als GitHub-Issue in `Leon-Achteresch/l8db` an. Geschwärzte Screenshots landen in einem öffentlichen Cloudflare-R2-Bucket und werden im Issue eingebettet. Nutzer brauchen kein GitHub-Konto.

## Einrichtung

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
