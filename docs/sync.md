# Synchronisation

Einstellungen → Allgemein → Synchronisation gleicht Verbindungen (ohne Passwörter), Servergruppen, gespeicherte Abfragen, Snippets, optional den Query-Verlauf und die portable Arbeitsumgebung über WebDAV oder einen Secret Gist ab. Die HTTP-Aufrufe laufen in Rust (`src-tauri/src/sync/`), Merge und Payload im Frontend (`src/lib/sync/`).

## Nebenläufigkeit

- WebDAV schreibt mit `If-Match` auf das ETag der gelesenen Datei (beim ersten Upload `If-None-Match: *`). Antwortet der Server mit 412, liest l8db neu, führt erneut zusammen und versucht es höchstens dreimal.
- GitHub bietet für Gists keine bedingten Schreibzugriffe. l8db liest direkt vor dem `PATCH` die aktuelle Gist-Version (`GET /gists/{id}/commits?per_page=1`) und vergleicht sie mit der Version, auf der der Merge beruht. Weicht sie ab, wird neu gelesen und zusammengeführt (höchstens drei Versuche). Nach dem `PATCH` prüft l8db, ob die vorherige Revision der erwarteten Version entspricht, und meldet sonst einen Hinweis.
- Verbleibendes Risiko bei Gists: Schreibt ein anderer Rechner im Zeitfenster zwischen der Versionsprüfung und dem `PATCH` (typisch einige hundert Millisekunden), überschreibt l8db dessen Stand. Der überschriebene Stand bleibt in der Revisionshistorie des Gists erhalten, und l8db zeigt einen Hinweis an.

## Secrets

Passwörter werden nur mit einer eigenen Sync-Passphrase übertragen (Argon2id, m = 64 MiB, t = 3, p = 1, AES-256-GCM). Jedes Secret ist ein eigener Eintrag mit Zeitstempel; geleerte Passwörter werden als Tombstone übertragen. Ein Secret vom Server überschreibt ein lokales nur, wenn das lokale seit der letzten Synchronisierung unverändert ist oder der Server-Stand neuer ist. Die Vergleichsbasis enthält nur HMAC-Werte mit einem gerätelokalen Schlüssel aus dem Schlüsselbund.
