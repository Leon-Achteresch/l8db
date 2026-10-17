# Team-Verbindungen: Datenbankverbindungen für ein ganzes Unternehmen

Nutzer melden sich in l8db mit ihrem Firmenkonto an und erhalten automatisch alle Verbindungen, die das Unternehmen für sie freigibt. Ohne Anmeldung verhält sich l8db unverändert.

- **Keine Rechte in l8db.** Freigaben entscheiden nur, wer welche Verbindung *sieht*. Was jemand in der Datenbank darf, regeln ausschließlich die Datenbank-Benutzer.
- **Keine Passwörter in den Freigaben.** Verbindungen enthalten Host, Port, Typ, SSL und optional SSH/Proxy. Beim ersten Verbinden fragt l8db nach Datenbank-Benutzer und Passwort und legt das Passwort im OS-Schlüsselbund ab. Einträge mit Passwort werden abgelehnt.

Es gibt zwei Wege:

| | Microsoft 365 (empfohlen) | Eigener Team-Hub |
|---|---|---|
| Für wen | Unternehmen mit Microsoft 365 / Entra ID | Google Workspace, Keycloak, Okta, Authentik, … |
| Server | keiner | ein kleiner Dienst mit HTTPS |
| Secrets beim Unternehmen | keine | Client-Secret und Session-Secret |
| Wer sieht was | SharePoint-Freigabe („Teilen“ mit Gruppen) | Gruppen-IDs in `connections.json` |
| Aufwand für die IT | etwa 15 Minuten | einige Stunden |

## Microsoft 365

### Was die IT tut (einmalig, etwa 15 Minuten)

1. **l8db freigeben.** Eine Person mit der Rolle *Globale Administration* oder *Cloudanwendungsadministration* öffnet in l8db *Einstellungen → Allgemein → Team-Verbindungen → Für die IT → Für die Organisation freigeben*. Microsoft zeigt die angefragten Berechtigungen; *Akzeptieren* gilt für alle im Unternehmen. Alternativ im Entra Admin Center unter *Unternehmensanwendungen → l8db → Berechtigungen → Administratorzustimmung erteilen*.
2. **SharePoint-Website `l8db` anlegen** als *Kommunikationswebsite* (nicht als Microsoft-Team: Team-Mitglieder dürfen Dateien bearbeiten). Besitzer: nur die IT. Am besten sofort anlegen, damit niemand anderes den Namen belegt, und die Adresse zusätzlich per Richtlinie festlegen (`siteUrl`, siehe unten). In der Dokumentbibliothek pro Zielgruppe einen Ordner anlegen, zum Beispiel `Alle`, `Vertrieb`, `Finanzen`.
3. **Freigeben.** Jeden Ordner über *Zugriff verwalten* mit **Leserechten** für die passende Entra-Gruppe freigeben. Schreibrechte nur für die IT: Wer schreiben darf, bestimmt, wohin sich alle Leser verbinden.
4. **Verbindungen teilen.** In l8db die Verbindung wie gewohnt anlegen und testen, dann im Menü der Verbindung *Für Team freigeben…* wählen und den Ordner aussuchen. l8db legt die Datei ohne Benutzer, Passwort, Tokens und lokale Schlüsselpfade ab; die eigene Verbindung wird dabei zur Team-Verbindung, Passwort, Verlauf und Tabs bleiben. Wird die Datei später in SharePoint gelöscht, verschwindet die Verbindung bei allen, auch bei der Person, die sie geteilt hat. *Zugriff in SharePoint verwalten* öffnet den Ordner. JSON von Hand ist nicht nötig, aber möglich (siehe unten).

Dringend empfohlen: per Richtlinie `MicrosoftSiteUrl` und `AllowedHosts` setzen (siehe *Richtlinie*). Erst damit kann weder eine fremde Website gleichen Namens noch jemand mit Schreibrecht Nutzer auf einen anderen Server lotsen.

Fertig. Neue Mitarbeitende bekommen ihre Verbindungen über die Gruppenmitgliedschaft.

### Gruppen und Zielgruppen

- Wer was sieht, ist genau die SharePoint-Leseberechtigung. Wer in mehreren Gruppen ist, sieht die Vereinigung. Kontrolle pro Person: in SharePoint *Zugriff prüfen*.
- Verschachtelte Entra-Sicherheitsgruppen funktionieren, Änderungen können wegen Caches bis zu einer Stunde dauern. Microsoft-365-Gruppen lassen sich nicht verschachteln.
- Ausnahmen („Vertrieb außer Max“) kennt SharePoint nicht; dafür eine eigene Gruppe anlegen.
- Eine Verbindung für mehrere Gruppen: eine Datei für mehrere Gruppen freigeben statt Kopien in mehrere Ordner legen (Kopien erscheinen doppelt).

### Für Team freigeben

Der Menüpunkt erscheint nur, wenn man mit Microsoft angemeldet ist, und nur bei eigenen, gespeicherten Verbindungen. Beim ersten Freigeben fragt Microsoft einmalig nach Schreibrechten (mit demselben Konto; ein anderes Konto wird abgelehnt). Erlaubt die Organisation keine Zustimmung durch Benutzer, bietet der Dialog *Als Administrator freigeben* an. Angefordert wird `Sites.ReadWrite.All`; im Modus `Sites.Selected` genügt eine Schreib-Zuweisung der App zur Website. Normale Nutzer erhalten diese Berechtigung nie, weil l8db sie nur beim Freigeben anfordert; ablegen kann ohnehin nur, wer in SharePoint Schreibrechte auf den Ordner hat. Verbindungen, die die Regeln für Team-Verbindungen verletzen (z. B. SQLite, Windows-Authentifizierung, nicht erlaubter Host), lehnt l8db vor dem Hochladen mit Begründung ab.

### Ohne Unternehmen

Ohne Richtlinie und ohne Anmeldung zeigt l8db von Team-Verbindungen nichts außer dem Bereich in den Einstellungen: kein Dialog beim Start, kein Menüpunkt, keine Hinweise.

### Was Nutzer tun

*Einstellungen → Allgemein → Team-Verbindungen → Mit Microsoft anmelden.* Auf Windows-Rechnern, die in Entra eingebunden sind, erscheint der Browser nur kurz ohne Passwortabfrage (Edge immer, Chrome mit Richtlinie `CloudAPAuthEnabled`, Firefox mit *Windows-Single-Sign-on zulassen*). Mit einer Richtlinie (siehe unten) erscheint der Anmeldedialog automatisch beim Start. Beim ersten Verbinden fragt l8db nach Datenbank-Benutzer und Passwort.

### Verbindungsdateien

Jede Datei mit der Endung `.json` in der Bibliothek (bis 4 Ordnerebenen, je Datei höchstens 256 KB, höchstens 1000 Dateien) wird gelesen. Eine Datei enthält eine Verbindung oder eine Liste:

```json
{ "name": "ERP Produktion", "kind": "mssql", "connectionString": "mssql://erp.intern:1433/erp?encrypt=true", "environment": "production" }
```

```json
{ "connections": [
  { "id": "reporting", "name": "Reporting", "kind": "postgres", "connectionString": "postgres://reporting.intern:5432/bi" },
  { "id": "lager", "name": "Lager", "kind": "mysql", "connectionString": "mysql://lager.intern:3306/lager" }
] }
```

- Pflicht: `kind` und `connectionString` **ohne Passwort oder Token** (auch nicht als `?password=`, `?token=` o. Ä.). Ist ein Benutzer eingetragen, fragt l8db nur nach dem Passwort.
- Adressen mit Steuerzeichen oder einem Backslash in URL-Form werden abgelehnt.
- Nicht erlaubt sind Parameter, die lokale Anmeldedaten, Sockets oder Dateien verwenden (`socket`): Windows-Authentifizierung (`integratedSecurity`, `Trusted_Connection`), Schlüssel- und Zertifikatsdateien (`private_key_file`, `sslkey`, `sslcert`, `sslrootcert`, `ssl-ca`, `tlsCAFile`, `tlsCertificateKeyFile`, `clientCertificateKeyStoreUrl` und Schreibvarianten mit `-`/`_`), `authenticator`/`auth`, `authMechanism`. Sonst könnte eine manipulierte Datei die Windows-Anmeldung oder Schlüssel an einen fremden Server schicken.
- Erlaubte Typen: `postgres`, `mysql`, `mssql`, `oracle`, `clickhouse`, `mongodb`, `redis`, `cassandra`, `elasticsearch`, `influxdb`, `snowflake`. Lokale Dateien (SQLite, DuckDB), ODBC-Treiber und Cloud-Typen mit lokalen Zugangsdaten sind aus Sicherheitsgründen ausgeschlossen.
- `id` immer setzen. Ohne `id` hängt die Verbindung am Dateinamen; eine umbenannte Datei ergibt dann eine neue Verbindung, und gespeicherte Passwörter gehen verloren. Fehlt `name`, wird der Dateiname verwendet.
- Optional: `sslMode`, `ssh`, `proxy`, `tags`, `color`, `readOnly`, `environment`, `schemas`. Andere Felder ignoriert l8db. Bei `ssh` werden Schlüsseldatei und Agent-Socket nicht übernommen; die wählt jede Person selbst.
- Fehlerhafte oder übersprungene Einträge zeigt l8db unter *Team-Verbindungen* als Hinweis. Andere Dateien bleiben nutzbar.
- Wurden nicht alle Dateien gelesen (zu groß, zu tief, zu viele, nicht herunterladbar, kein gültiges JSON, Eintrag ohne `kind`) oder ist die bekannte Website gerade nicht erreichbar, entfernt l8db bei diesem Abgleich keine Verbindungen.
- Ändert die IT Typ, Verbindungsadresse (inklusive Datenbank und Parametern), SSL-Modus, SSH oder Proxy, löscht l8db die gespeicherten Passwörter und fragt beim nächsten Verbinden neu. Nur Name, Farbe, Tags, Umgebung, Schemas und Schreibschutz lassen sich ohne neue Abfrage ändern. Die Passwortabfrage zeigt bei Team-Verbindungen das Ziel an.
- Mit der Richtlinie `AllowedHosts` (z. B. `*.firma.intern;db01`) übernimmt l8db nur Verbindungen, deren sämtliche Ziele darauf passen: Host der Adresse, Host-Parameter wie `host`, `hostaddr`, `endpoint`, `Server`, `Failover Partner`, SSH-Host, SSH-Ziel, Jump-Hosts und Proxy. IPv6 ohne eckige Klammern wird dann abgelehnt. l8db prüft beim Einlesen alle Ziele und zusätzlich im Backend den Host, den der jeweilige Datenbanktreiber tatsächlich verwendet (inklusive Oracle-TNS-Beschreibungen, Postgres `hostaddr`, Cassandra-Knoten, SSH und Proxy). Cluster-Adressen mit mehreren Hosts (MongoDB-Replica-Sets, Postgres-HA, Cassandra-Knoten) sind erlaubt, wenn jeder einzelne Host passt. Mit gesetzter Allowlist gehen benannte SQL-Server-Instanzen nur in URL-Form (`mssql://db01:1433/…`), nicht als `Server=db01\INST`, und SSH-Ziele wie `localhost` müssen ausdrücklich erlaubt sein. Keine Muster für fremde Cloud-Domains verwenden (`*.database.windows.net` passt auf die Server jedes Azure-Kunden), sondern die eigenen Servernamen. Empfohlen: So kann auch jemand mit Schreibrecht oder eine fremde Website niemanden auf einen anderen Server lotsen.

### Sicherheit

- l8db meldet sich als öffentlicher Client direkt bei Microsoft an (Authorization Code mit PKCE, Rückleitung auf `http://127.0.0.1:<Port>`). Es gibt kein Secret, und kein Server des l8db-Projekts sieht Anmeldedaten, Tokens oder Verbindungen.
- Angefragte Berechtigungen (delegiert, also nur mit den Rechten der angemeldeten Person): `openid`, `profile`, `offline_access`, `Sites.Read.All`. `Sites.Read.All` erlaubt technisch das Lesen aller SharePoint-Inhalte, auf die die Person ohnehin Zugriff hat; l8db liest nur die eine Website. Wer das einschränken will, nutzt den Modus `Sites.Selected` (unten).
- l8db merkt sich die Website beim ersten Abgleich. Wird sie gelöscht und unter gleichem Namen neu angelegt, übernimmt l8db nichts mehr, bis sich die Person neu anmeldet. Ohne vorgegebene `siteUrl` nimmt l8db die erste Website namens `l8db`; deshalb `siteUrl` per Richtlinie festlegen.
- l8db gleicht beim Start und beim Wechsel ins Fenster ab, höchstens einmal pro Stunde, und pollt sonst nicht.
- Entzieht die IT einer Person alle Freigaben, entfernt l8db die Verbindungen erst, wenn die Website für diese Person ausdrücklich keinen Inhalt mehr liefert. Den Zugriff selbst sperrt immer der Datenbank-Benutzer oder das Konto.
- Das Refresh-Token liegt im OS-Schlüsselbund. Sperrt die IT das Konto oder widerruft die Sitzungen, schlägt der nächste Abgleich fehl, und l8db verlangt eine neue Anmeldung. Gelingt sie 14 Tage lang nicht, entfernt l8db die Team-Verbindungen samt gespeicherter Passwörter. Den eigentlichen Zugriff sperrt die IT über das Konto bzw. den Datenbank-Benutzer.
- Setzt die IT `tenant` auf eine Verzeichnis-ID, verlangt l8db von bereits angemeldeten Personen aus einer anderen Organisation eine neue Anmeldung.
- Conditional Access, MFA und *Zuweisung erforderlich* der Unternehmensanwendung `l8db` wirken wie bei jeder anderen Microsoft-App. Meldungen wie „nicht freigeschaltet“ oder „durch Richtlinie blockiert“ zeigt l8db verständlich mit dem AADSTS-Code an.
- Hilfe bei Problemen: *Diagnose kopieren* unter *Team-Verbindungen* (Version, Quelle, Website, Anzahl, Hinweise, letzter Fehler; keine Tokens).

### Modus mit minimalen Rechten (`Sites.Selected`)

Statt `Sites.Read.All` fordert l8db dann nur `Sites.Selected` an. Die App darf ausschließlich Websites lesen, die ihr ausdrücklich zugewiesen wurden. Richtlinie: `"scope": "selected"` und `"siteUrl"` (Pflicht). Die Zuweisung erfolgt einmal per PowerShell, zum Beispiel mit PnP:

```powershell
Grant-PnPAzureADAppSitePermission -AppId <Anwendungs-ID> -DisplayName l8db -Site https://firma.sharepoint.com/sites/l8db -Permissions Read
```

*Ungeprüft:* Das Zusammenspiel von delegiertem `Sites.Selected` mit dieser Zuweisung ist neu bei Microsoft; vor dem Rollout in einem Test-Tenant prüfen.

### Eigene App-Registrierung (optional)

Wer der App des l8db-Projekts nicht vertrauen möchte, registriert eine eigene: *App-Registrierungen → Neue Registrierung*, Kontotyp *Nur dieses Verzeichnis*, Plattform *Mobile und Desktop*, *Öffentliche Clientflows zulassen* = Ja, delegierte Graph-Berechtigungen wie oben, kein Secret. Die Umleitungs-URI `http://127.0.0.1` lässt sich im Portal nicht eintragen; im Manifest unter `publicClient.redirectUris` ergänzen (*vor dem Rollout prüfen*, das Manifestformat ändert Microsoft gelegentlich). Dann per Richtlinie `clientId` und `tenant` setzen.

### Für Maintainer: Projekt-App

Die Anwendungs-ID der Projekt-App steht in `CLIENT_ID` in `src-tauri/src/team_m365.rs`. Registrierung: Kontotyp *Konten in einem beliebigen Organisationsverzeichnis*, Plattform *Mobile und Desktop* mit `http://127.0.0.1` (Manifest) und `http://localhost`, *Öffentliche Clientflows zulassen* = Ja, delegierte Graph-Berechtigungen `openid`, `profile`, `offline_access`, `Sites.Read.All`, `Sites.ReadWrite.All` (nur fürs Freigeben angefordert), `Sites.Selected`, kein Secret. Pflicht: mindestens zwei Besitzer mit phishing-resistenter MFA; empfohlen: Herausgeberüberprüfung, damit Microsoft die App als verifiziert anzeigt. Ist `CLIENT_ID` leer, blendet l8db den Microsoft-Weg aus, außer eine Richtlinie setzt `clientId`.

## Eigener Team-Hub

Der Team-Hub ist ein optionaler, selbst gehosteter Dienst für alle OpenID-Connect-Anbieter. Admins pflegen die Verbindungen in einer Datei auf dem Server; Nutzer brauchen nur die Hub-Adresse.

### Ablauf

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

### Hub betreiben

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

#### Verbindungsdatei

Vorlage: `hub/connections.example.json`. Der Hub liest die Datei nach jeder Änderung neu ein; ein Neustart ist nicht nötig. Ist eine Datei ungültig, verweigert der Hub den Start bzw. die Auslieferung und protokolliert den Fehler.

- `id` (Pflicht, `A-Z a-z 0-9 _ -`, stabil halten: Eine neue `id` bedeutet eine neue Verbindung), `name`, `kind` (wie in l8db, z. B. `postgres`, `mysql`, `mssql`, `oracle`), `connectionString` **ohne Passwort**. Ist ein Benutzer eingetragen, wird nur nach dem Passwort gefragt.
- Optional werden übernommen: `sslMode`, `ssh`, `proxy`, `tags`, `color`, `readOnly`, `environment`, `schemas`. Befehls-Tunnel, Cloud-Anmeldung und alle anderen Felder ignoriert l8db aus Sicherheitsgründen.
- `groups`: Liste von Gruppen-IDs oder App-Rollen. Leer oder fehlend heißt: alle angemeldeten Nutzer.

### Entra ID mit eigenem Hub

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

### In l8db

*Einstellungen* → *Allgemein* → *Team-Verbindungen* → *Eigenen Team-Hub verwenden*: Hub-Adresse eintragen und *Beim Team-Hub anmelden* wählen. Danach erscheinen die Verbindungen in der normalen Verbindungsliste. Beim ersten Öffnen fragt l8db nach Datenbank-Benutzer und Passwort.

## Richtlinie: Anmeldung automatisch anbieten und festlegen

Mit einer Richtlinie zeigt l8db beim Start automatisch *Mit Firmenkonto anmelden*, auch vor dem Onboarding beim ersten Start, und die Quelle ist in den Einstellungen fest vorgegeben. Bei späteren Starts wird nur still abgeglichen. Wer *Später* wählt, wird beim nächsten Start erneut gefragt. Wechselt die IT die Quelle, meldet l8db von der alten ab.

**Windows (empfohlen per GPO oder Intune):** Registry unter `HKLM\SOFTWARE\Policies\l8db`, nur von Administratoren beschreibbar.

| Wert | Typ | Bedeutung |
|---|---|---|
| `Microsoft` | DWORD | `1` = Microsoft 365 verwenden |
| `MicrosoftSiteUrl` | REG_SZ | z. B. `https://firma.sharepoint.com/sites/l8db` (empfohlen) |
| `MicrosoftScope` | REG_SZ | `all` (Standard) oder `selected` |
| `MicrosoftTenant` | REG_SZ | Verzeichnis-ID oder Domain, beschränkt die Anmeldung auf das eigene Verzeichnis |
| `MicrosoftSite` | REG_SZ | nur der Name der Website (Standard `l8db`), wenn keine `MicrosoftSiteUrl` gesetzt ist |
| `MicrosoftClientId` | REG_SZ | eigene App-Registrierung (optional) |
| `AllowedHosts` | REG_SZ | erlaubte Datenbank-Hosts, durch `;` getrennt, z. B. `*.firma.intern;db01` (empfohlen) |
| `HubUrl` | REG_SZ | stattdessen eigener Team-Hub |

Eine ADMX-Vorlage für Gruppenrichtlinien und Intune (*Importierte administrative Vorlagen*) liegt unter `packaging/windows-policy/` (Deutsch und Englisch). `Microsoft` = `0` (Richtlinie *Deaktiviert*) blendet den Microsoft-Weg aus; ein eigener Team-Hub bleibt möglich. Eine ältere `C:\ProgramData\l8db\hub.json` liest l8db aus Sicherheitsgründen nicht mehr (Standardbenutzer dürfen dort schreiben); liegt sie noch dort, zeigt l8db einen Hinweis auf die Registry-Richtlinie, bis sie gelöscht ist. Ist eine Richtlinie ungültig (Registry oder Datei), gleicht l8db keine Team-Verbindungen ab und erlaubt keine Team-Anmeldung, bis sie korrigiert ist; der Fehler steht unter *Team-Verbindungen* und in *Diagnose kopieren*. Eine Richtlinie darf auch nur `AllowedHosts` setzen; dann wählen Nutzer die Quelle selbst, aber nur erlaubte Hosts werden übernommen.

```powershell
New-Item -Force "HKLM:\SOFTWARE\Policies\l8db" | Out-Null
Set-ItemProperty "HKLM:\SOFTWARE\Policies\l8db" Microsoft 1 -Type DWord
Set-ItemProperty "HKLM:\SOFTWARE\Policies\l8db" MicrosoftSiteUrl "https://firma.sharepoint.com/sites/l8db"
```

In Intune als *Plattformskript* (PowerShell, im Systemkontext) oder als Wartungsskript verteilen.

**macOS / Linux:** Datei `hub.json` unter `/Library/Application Support/l8db/hub.json` bzw. `/etc/l8db/hub.json` (nur mit Administratorrechten beschreibbar):

```json
{ "microsoft": { "siteUrl": "https://firma.sharepoint.com/sites/l8db" } }
```

oder für einen eigenen Hub `{ "url": "https://l8db.firma.example" }`. Felder unter `microsoft`: `siteUrl`, `site` (nur Name, Standard `l8db`), `scope`, `tenant`, `clientId`. Auf oberster Ebene zusätzlich `"allowedHosts": ["*.firma.intern"]`.

**Nur für einen Benutzer:** `hub.json` im App-Datenordner (`%LOCALAPPDATA%\com.leon.l8db\`, `~/Library/Application Support/com.leon.l8db/`, `~/.local/share/com.leon.l8db/`). `L8DB_HUB_FILE=<Pfad>` hat Vorrang vor Dateien.

Reihenfolge: Registry (Windows), `L8DB_HUB_FILE`, systemweite Datei, Benutzerdatei. Ungültige Einträge werden übersprungen und protokolliert. Die Richtlinie enthält keine Geheimnisse.

## Grenzen

- Eigener Hub: keine Weboberfläche für Admins, die Verbindungen stehen in einer JSON-Datei auf dem Server. Die Hub-Adresse wird eingetippt oder per `hub.json` vorgegeben.
- Anmeldevorgänge liegen im Speicher. Eine Hub-Instanz pro Adresse; nach einem Neustart läuft eine gerade laufende Anmeldung ins Leere.
- Hub-Tokens lassen sich nicht einzeln widerrufen. Sie laufen ab, oder `L8DB_HUB_SESSION_SECRET` wird gewechselt. Da der Hub keine Passwörter ausliefert, sperrt man den Datenbankzugriff über den Datenbank-Benutzer.
- Datenbank-Anmeldung per Entra-Token oder Kerberos ist noch nicht angebunden.

## Tests

- `bun test tests/team-hub.test.ts tests/team-sync.test.ts`: Hub-Ablauf mit simuliertem IdP, Merge, Abgleich und Performance.
- `bun test tests/team-policy.test.ts`: ADMX-Vorlage passt zu den gelesenen Registry-Werten.
- `cargo test team` (in `src-tauri/`): Loopback-Login, PKCE, Abbruch, Microsoft-Anmeldung, Zustimmungsfehler und SharePoint-Abruf gegen einen simulierten Microsoft-Server.
- End-to-End mit echtem IdP (ignoriert): Hub und einen OIDC-Provider starten, dann `L8DB_TEAM_E2E_HUB=<Hub> L8DB_TEAM_E2E_BROWSER=<Bun-Skript, das den Login im Browser durchklickt> L8DB_TEAM_E2E_EXPECT=<erwartete IDs, kommagetrennt> cargo test --lib team::tests::e2e -- --ignored`.
