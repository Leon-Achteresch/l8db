# Live-Einrichtung auf dem vorhandenen VPS

Stand: 2026-11-04. Der Relay ist auf dem eigenen VPS unter `https://issues.leon-achteresch.de` aktiv. Es wurde kein Cloudflare-R2-Abonnement aktiviert und kein Cloudflare-Worker deployt. Es gibt kein GitHub-Assets-Repository.

## Betrieb

- VPS: `89.163.229.74`, bestehender SSH-Alias `fast4-vm1302` (Benutzer `kunde1302`, vorhandener Schlüssel, Docker über sudo).
- Coolify: Projekt `l8db`, Umgebung `production`, Service `l8db-issue-relay`, Service-ID `reul7fkldpnxvo9kw5fohow1`. Die Einrichtung erfolgte über Codex Computer Use am echten Mac-Desktop; Build, Schlüsseltransfer und technische Prüfungen über den autorisierten SSH-Zugang.
- Live-Image: `l8db-issue-relay:08e18336`, gebaut aus Commit `08e18336`. Die SHA-256-Werte aller vier ausgelieferten JavaScript-Dateien wurden mit diesem Quellstand verglichen und stimmen überein.
- Laufzeit: Node.js 24; Bun 1.3.10 läuft auf der alten VPS-CPU nicht zuverlässig. Die l8db-Projekt-Toolchain bleibt unverändert bei Bun. Scoped Plattform- und Leistungsnachweise: [PERFORMANCE.md](PERFORMANCE.md).
- Container: Benutzer `node` (UID 1000), Read-only-Rootfs, 256 MiB RAM, 0,5 CPU, keine veröffentlichten Host-Ports. Traefik erreicht intern Port 3000.
- DNS: IONOS-A-Record ausschließlich für `issues.leon-achteresch.de` auf `89.163.229.74`, TTL 3600. Root-, Wildcard-, Mail- und andere Subdomain-Einträge blieben erhalten. Autoritative DNS-Abfrage sowie Google und Cloudflare Resolver bestätigten das Ziel; ältere Resolver-Caches können bis zum TTL-Ende noch den vorherigen Wildcard-Wert sehen.
- HTTPS: Coolify/Traefik, Let's Encrypt, Zertifikatsprüfung bei den Live-Prüfungen aktiv. Das initiale Ausstellen des Zertifikats war beim ersten Zugriff noch nicht abgeschlossen; die späteren HTTPS-Prüfungen bestanden ohne Umgehung der Zertifikatsprüfung.
- Dauerhaftes Volume: `reul7fkldpnxvo9kw5fohow1_screenshots`, Mount `/data`, Bilder unter `/data/screenshots`. Das Testbild blieb über einen Redeploy byteidentisch erhalten.
- App-Schlüssel: `/data/l8db-issue-relay/secrets/github-app.pem`, nur per SSH übertragen, Eigentümer UID/GID 1000, Modus `0400`; im Container read-only unter `/run/secrets/github-app.pem`. Kein Schlüsselinhalt steht im Repository, Docker-Image oder im Coolify-Formular. Volume und Schlüssel sind getrennt zu sichern; eine neue automatische Offsite-Sicherung wurde nicht eingerichtet.

GitHub-App `l8db-issue-relay`, App-ID `5606404`, Installations-ID `178437458`: Webhook aus, ausschließlich Issues Read & write und verpflichtendes Metadata Read, installiert nur auf `Leon-Achteresch/l8db`. Die Repository-Variable `L8DB_ISSUE_RELAY_URL` ist auf `https://issues.leon-achteresch.de` gesetzt und per API verifiziert. Der nächste separat beauftragte Release übernimmt diese URL in die App; in diesem Auftrag wurde kein Release oder Canary ausgelöst.

## Synthetische Live-Prüfung

[Test-Issue #247](https://github.com/Leon-Achteresch/l8db/issues/247) wurde mit HTTP 201 als `l8db-issue-relay[bot]` erstellt, erhielt `bug` und `ai-report` sowie das bestehende automatische Triage-Label und wurde nach erfolgreicher Prüfung wieder geschlossen. Es enthielt nur künstlichen Text und ein programmgeneriertes 320 × 180 PNG mit schwarzen Balken, keine echten Screenshots, Verbindungsdaten oder Diagnosen.

- `GET /health`: HTTP 200 über HTTPS vom Mac und vom VPS.
- Das Bild wurde im Issue eingebettet und im echten Chrome sichtbar geprüft. Der öffentliche Bildabruf war HTTP 200 und byteidentisch, auch nach Redeploy.
- Bild: `https://issues.leon-achteresch.de/screenshots/247-bd6391e9-4d8b-41cc-8271-8b50e6770a89.png`.
- Bild-SHA-256: `34409ca9fb98416f34eb493252fab43cd6e438ea223f90fd2841bee246346e61`.
- Vier aufeinanderfolgende ungültige Berichte aus derselben echten Quelle mit jeweils anderen gefälschten `X-Forwarded-For`- und `CF-Connecting-IP`-Werten ergaben `400, 400, 400, 429`. Die Antwort des vierten Requests lautet: `Zu viele Berichte. Bitte in einer Minute erneut versuchen.` Es entstanden dadurch keine weiteren Test-Issues.
- Ein zuerst beobachtetes HTTP-502-Problem bei frühen Rate-Limit-Antworten wurde in `08e18336` korrigiert: Eine nicht gelesene Anfrage wird vor dem Senden der Antwort nicht mehr vorzeitig abgebrochen. Der gezielte echte HTTP-Regressionstest besteht lokal und im VPS-Container; danach bestand die obige Live-Prüfung.

Die Live-Prüfung belegt die Relay-, GitHub-, TLS- und Speicher-Einrichtung, nicht die Screenshot-Schwärzung im App-Fenster oder einen neu gebauten/releasten App-Client. Diese bestehenden App-Dialoge und die Bestätigungslogik wurden hier nicht erneut end-to-end getestet. Es gab genau einen schreibgeschützten Code-Review; die beiden P2-Funde wurden nach ausdrücklicher Zustimmung behoben, kein erneuter Review wurde gestartet.

## Aktualisieren

Den gewünschten Quellstand auf dem VPS im Verzeichnis `/data/l8db-issue-relay/source` bereitstellen und daraus ein neues lokales Image mit Commit-Tag bauen. In Coolify unter **General → Relay-Ressourceneinstellungen → Image** diesen Tag eintragen und speichern, dann **More actions → Pull latest and restart** ausführen. Der Eintrag in den Ressourceneinstellungen ist maßgeblich; nur den Rohtext im Compose-Editor zu ändern aktualisierte in dieser Coolify-Version den vorhandenen Image-Eintrag nicht. `pull_policy: never` erhält die Verwendung des bereits lokal gebauten Images.

Den vorhandenen Volume-Namen, die Domain und den Schlüssel-Mount erhalten. Danach Container-Image, Health-Status und Bildabruf prüfen. Die bestehenden Limits und die bekannte fehlende Endpunkt-Anmeldung sind in [README.md](README.md) dokumentiert. Das synthetische Testbild unterliegt derselben 365-Tage-Aufbewahrung wie andere Bilder.
