# Issue-Relay

Nimmt Fehlerberichte aus l8db an (KI-Chat-Tool und MCP-Tool `report_issue`) und legt sie als GitHub-Issue in `Leon-Achteresch/l8db` an. Geschwärzte Screenshots landen im öffentlichen Repo `Leon-Achteresch/l8db-issue-assets` und werden im Issue eingebettet. Nutzer brauchen kein GitHub-Konto.

## Einrichtung

1. Öffentliches Repo `Leon-Achteresch/l8db-issue-assets` mit einem ersten Commit anlegen.
2. GitHub-App anlegen (Settings → Developer settings → GitHub Apps), ohne Webhook. Rechte: *Issues: Read & write* und *Contents: Read & write*. Die App nur auf `l8db` und `l8db-issue-assets` installieren. App-ID und Installations-ID (aus der URL der Installation) notieren, einen Private Key erzeugen.
3. Den Schlüssel nach PKCS#8 umwandeln: `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem`.
4. Im Ordner `services/issue-relay`:
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
- Bekannte Grenze: Der Endpunkt hat keine Anmeldung, die URL steckt in der App. Wer sie ausliest, kann bis zu 3 Berichte pro Minute und IP anlegen. Bei Missbrauch die Grenze in `wrangler.toml` senken oder Cloudflare Turnstile davorschalten.
- Erst wird das Issue angelegt, dann das Bild hochgeladen und verlinkt. Ohne Issue entstehen keine verwaisten Bilder.
- Über MCP muss der Agent `confirm=true` setzen, nachdem der Nutzer Titel und Text gesehen hat. Über MCP gibt es keinen Screenshot, weil der Server ohne Fenster läuft.
- Die App schwärzt vor dem Senden alle Texte, Eingaben, Bilder und Canvas im Screenshot und filtert Zugangsdaten aus dem Text. Der Nutzer sieht die Vorschau und bestätigt jeden Bericht.
