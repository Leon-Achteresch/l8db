# Team-Hub: Verbindungen für ein ganzes Team

Der Team-Hub ist ein optionaler, selbst gehosteter Dienst. Admins pflegen die Verbindungen an einer Stelle; Nutzer melden sich in l8db mit ihrem Firmenkonto an und erhalten die für sie freigegebenen Verbindungen. Ohne Hub verhält sich l8db unverändert.

- **Keine Rechte in l8db.** Der Hub entscheidet nur, wer welche Verbindung *sieht*. Was jemand in der Datenbank darf, regeln ausschließlich die Datenbank-Benutzer.
- **Keine Passwörter im Hub.** Verbindungen enthalten Host, Port, Typ, SSL und optional SSH/Proxy. Beim ersten Verbinden fragt l8db nach Datenbank-Benutzer und Passwort und legt das Passwort im OS-Schlüsselbund ab. Der Hub lehnt Verbindungsdateien mit Passwort ab.
- **Keine Dateien auf den Rechnern.** Nutzer brauchen nur die Hub-Adresse.

## Ablauf

```
l8db ──Browser──▶ Hub /auth/login ──▶ Identity Provider (OIDC, z. B. Entra ID)
     ◀──127.0.0.1-Callback (Einmalcode)── Hub ◀── Code ─┘
l8db ──Einmalcode + PKCE-Verifier──▶ Hub /auth/token ──▶ Hub-Token (im Schlüsselbund)
l8db ──Bearer──▶ Hub /api/connections ──▶ freigegebene Verbindungen
```

- Der Hub ist der OIDC-Client (Authorization Code + PKCE, `client_secret_post`). Client-ID und Secret liegen nur auf dem Hub-Server; l8db braucht kein Secret.
- l8db öffnet den Systembrowser und wartet auf `http://127.0.0.1:<zufälliger Port>/callback`. Den Einmalcode tauscht es nur mit seinem PKCE-Verifier ein. Das Hub-Token liegt im OS-Schlüsselbund, nie im Web-Frontend.
- Der Hub prüft am ID-Token Aussteller, Zielgruppe, Ablauf und `nonce`. Er erhält das Token direkt per TLS vom Token-Endpunkt (OIDC Core 3.1.3.7). Gruppen kommen aus den Claims `groups` und `roles`.
- Hub-Tokens sind HMAC-signiert und standardmäßig 7 Tage gültig (`L8DB_HUB_TOKEN_TTL_SECONDS`). Gruppenänderungen greifen bei der nächsten Anmeldung.
- l8db gleicht beim Start und auf Knopfdruck ab, es pollt nicht. Neue Verbindungen werden ergänzt, entfernte gelöscht. Lokale Änderungen (Name, Farbe, Benutzer) bleiben erhalten, solange der Admin dasselbe Feld nicht ändert. Team-Verbindungen werden nicht über die persönliche Synchronisation übertragen. Beim Abmelden werden sie entfernt.

## Hub betreiben

Der Hub ist eine einzelne Datei (`hub/server.ts`) ohne Abhängigkeiten. Er läuft mit Bun 1.3 unter Linux, macOS und Windows. HTTPS terminiert ein Reverse Proxy (Caddy, nginx, IIS mit ARR o. Ä.). l8db akzeptiert nur `https://`, außer bei `localhost`.

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `L8DB_HUB_ISSUER` | ja | OIDC-Issuer, z. B. `https://login.microsoftonline.com/<Tenant-ID>/v2.0` |
| `L8DB_HUB_CLIENT_ID` | ja | Client-ID der App-Registrierung |
| `L8DB_HUB_CLIENT_SECRET` | ja | Client-Secret der App-Registrierung |
| `L8DB_HUB_PUBLIC_URL` | ja | Öffentliche Adresse, z. B. `https://l8db.firma.example` (auch mit Pfad, z. B. `/l8db`) |
| `L8DB_HUB_SESSION_SECRET` | ja | Mindestens 32 zufällige Zeichen. Wird es geändert, müssen sich alle neu anmelden |
| `L8DB_HUB_CONNECTIONS_FILE` | nein | Pfad zur Verbindungsdatei (Standard `connections.json`, im Container `/config/connections.json`) |
| `L8DB_HUB_NAME` | nein | Anzeigename in l8db |
| `L8DB_HUB_SCOPES` | nein | Standard `openid profile email` |
| `L8DB_HUB_TOKEN_TTL_SECONDS` | nein | Gültigkeit des Hub-Tokens, Standard 604800 |
| `PORT` | nein | Standard 8080 |

```bash
docker build -t l8db-hub hub
docker run -d --name l8db-hub -p 8080:8080 --env-file hub.env \
  -v /srv/l8db-hub:/config:ro l8db-hub
```

Ohne Docker: `bun hub/server.ts`, die Variablen werden aus der Umgebung gelesen. Ein Session-Secret erzeugt `openssl rand -base64 48` bzw. in PowerShell 7 `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`.

### Verbindungsdatei

Vorlage: `hub/connections.example.json`. Der Hub liest die Datei nach jeder Änderung neu ein; ein Neustart ist nicht nötig. Ist eine Datei ungültig, verweigert der Hub den Start bzw. die Auslieferung und protokolliert den Fehler.

- `id` (Pflicht, `A-Z a-z 0-9 _ -`, stabil halten: Eine neue `id` bedeutet eine neue Verbindung), `name`, `kind` (wie in l8db, z. B. `postgres`, `mysql`, `mssql`, `oracle`), `connectionString` **ohne Passwort**. Ist ein Benutzer eingetragen, wird nur nach dem Passwort gefragt.
- Optional werden übernommen: `sslMode`, `ssh`, `proxy`, `tags`, `color`, `readOnly`, `environment`, `schemas`. Befehls-Tunnel, Cloud-Anmeldung und alle anderen Felder ignoriert l8db aus Sicherheitsgründen.
- `groups`: Liste von Gruppen-IDs oder App-Rollen. Leer oder fehlend heißt: alle angemeldeten Nutzer.

## Entra ID (Microsoft 365, Windows)

1. **App registrieren**: Entra Admin Center → *Anwendungen* → *App-Registrierungen* → *Neue Registrierung*.
   - Name: `l8db Team-Hub`, Kontotyp: *Nur Konten in diesem Organisationsverzeichnis*.
   - Umleitungs-URI: Plattform *Web*, `https://<Hub-Adresse>/auth/callback`.
2. **Werte notieren** (*Übersicht*): *Anwendungs-ID (Client)* → `L8DB_HUB_CLIENT_ID`, *Verzeichnis-ID (Mandant)* → `L8DB_HUB_ISSUER=https://login.microsoftonline.com/<Verzeichnis-ID>/v2.0`.
3. **Secret**: *Zertifikate & Geheimnisse* → *Neuer geheimer Clientschlüssel*. Den **Wert** (nicht die Geheimnis-ID) als `L8DB_HUB_CLIENT_SECRET` hinterlegen und vor Ablauf erneuern.
4. **Berechtigungen**: Unter *API-Berechtigungen* reicht die vorhandene delegierte Berechtigung `User.Read`. Dort *Administratorzustimmung erteilen*, damit Nutzer keinen Zustimmungsdialog sehen.
5. **Gruppen freigeben**, eine der beiden Varianten:
   - *Tokenkonfiguration* → *Gruppenanspruch hinzufügen* → *Sicherheitsgruppen*, im ID-Token als *Gruppen-ID*. In `groups` stehen dann die Objekt-IDs der Gruppen. Bei Nutzern mit mehr als 200 Gruppen lässt Entra den Claim weg; wählen Sie dann *Der Anwendung zugewiesene Gruppen* und weisen Sie die Gruppen der Unternehmensanwendung zu.
   - Oder *App-Rollen* → *App-Rolle erstellen* (zulässige Mitglieder: Benutzer/Gruppen, Wert z. B. `l8db-erp`) und die Rolle unter *Unternehmensanwendungen* → *Benutzer und Gruppen* zuweisen. In `groups` steht dann der Rollenwert. Gruppen statt einzelner Benutzer zuzuweisen erfordert Entra ID P1.
6. **Zugriff beschränken** (empfohlen): *Unternehmensanwendungen* → `l8db Team-Hub` → *Eigenschaften* → *Zuweisung erforderlich* = *Ja*. Dann können sich nur zugewiesene Benutzer/Gruppen anmelden.

Auf Windows-Rechnern, die in Entra eingebunden sind (auch hybrid), ist der Browser über das Windows-Konto bereits angemeldet. Das Browserfenster erscheint dann nur kurz, ohne Passwortabfrage. Das gilt für Edge immer, für Chrome mit der Richtlinie `CloudAPAuthEnabled` und für Firefox mit *Windows-Single-Sign-on zulassen*.

Andere Anbieter (Google Workspace, Keycloak, Authentik, Okta) funktionieren genauso: Redirect-URI `https://<Hub-Adresse>/auth/callback` eintragen, Issuer, Client-ID und Secret setzen. Gruppen müssen im ID-Token als `groups` oder `roles` ankommen.

## In l8db

*Einstellungen* → *Allgemein* → *Team-Verbindungen*: Hub-Adresse eintragen und *Mit Firmenkonto anmelden* wählen. Danach erscheinen die Verbindungen in der normalen Verbindungsliste. Beim ersten Öffnen fragt l8db nach Datenbank-Benutzer und Passwort.

### Automatische Anmeldung per `hub.json`

Legt die IT eine Datei `hub.json` an einem festen Ort ab, zeigt l8db beim Start automatisch den Dialog *Mit Firmenkonto anmelden*, auch vor dem Onboarding beim ersten Start. Nach der Anmeldung werden die Verbindungen ohne weiteres Zutun eingerichtet. Bei späteren Starts wird nur noch still abgeglichen. Wer *Später* wählt, wird beim nächsten Start erneut gefragt. Die Hub-Adresse in den Einstellungen ist dann fest vorgegeben.

```json
{ "url": "https://l8db.firma.example" }
```

l8db sucht in dieser Reihenfolge und nimmt die erste vorhandene Datei:

| | Für alle Benutzer (empfohlen, per GPO/Intune/MDM) | Nur für einen Benutzer |
|---|---|---|
| Windows | `%ProgramData%\l8db\hub.json` (meist `C:\ProgramData\l8db\hub.json`) | `%LOCALAPPDATA%\com.leon.l8db\hub.json` |
| macOS | `/Library/Application Support/l8db/hub.json` | `~/Library/Application Support/com.leon.l8db/hub.json` |
| Linux | `/etc/l8db/hub.json` | `~/.local/share/com.leon.l8db/hub.json` (bzw. `$XDG_DATA_HOME/com.leon.l8db/hub.json`) |

Zusätzlich hat `L8DB_HUB_FILE=<Pfad>` Vorrang vor allen anderen Orten. Die Datei enthält keine Geheimnisse und darf für alle lesbar sein. Sie darf mit UTF-8-BOM gespeichert werden (PowerShell, Notepad). Ist eine Datei ungültig, zum Beispiel ohne `https://`, überspringt l8db sie und prüft den nächsten Ort. Ist keine gültig, startet l8db ohne Dialog und schreibt eine Warnung ins Log. Wechselt die IT die Adresse, meldet l8db beim nächsten Start vom alten Hub ab und fragt nach der Anmeldung am neuen.

Beispiel für Windows (PowerShell als Administrator):

```powershell
New-Item -ItemType Directory -Force "$env:ProgramData\l8db" | Out-Null
'{ "url": "https://l8db.firma.example" }' | Set-Content -Encoding utf8 "$env:ProgramData\l8db\hub.json"
```

## Grenzen

- Keine Erkennung des Hubs über die E-Mail-Domain. Die Adresse wird eingetippt oder per `hub.json` vorgegeben.
- Keine Weboberfläche für Admins: Die Verbindungen stehen in einer JSON-Datei auf dem Hub-Server.
- Anmeldevorgänge liegen im Speicher. Eine Hub-Instanz pro Adresse; nach einem Neustart läuft eine gerade laufende Anmeldung ins Leere.
- Hub-Tokens lassen sich nicht einzeln widerrufen. Sie laufen ab, oder `L8DB_HUB_SESSION_SECRET` wird gewechselt. Da der Hub keine Passwörter ausliefert, sperrt man den Datenbankzugriff über den Datenbank-Benutzer.
- Datenbank-Anmeldung per Entra-Token oder Kerberos ist noch nicht angebunden.

## Tests

- `bun test tests/team-hub.test.ts tests/team-sync.test.ts`: Hub-Ablauf mit simuliertem IdP, Merge, Abgleich und Performance.
- `cargo test team::` (in `src-tauri/`): Loopback-Login, PKCE und Abbruch.
- End-to-End mit echtem IdP (ignoriert): Hub und einen OIDC-Provider starten, dann `L8DB_TEAM_E2E_HUB=<Hub> L8DB_TEAM_E2E_BROWSER=<Bun-Skript, das den Login im Browser durchklickt> L8DB_TEAM_E2E_EXPECT=<erwartete IDs, kommagetrennt> cargo test --lib team::tests::e2e -- --ignored`.
