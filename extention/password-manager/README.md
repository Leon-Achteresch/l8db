# Passwortmanager-Sync

Speichert l8db-Verbindungen in Keeper, Bitwarden oder 1Password und lädt sie von dort, inklusive Zugängen aus geteilten Sammlungen, Tresoren und Ordnern. Anleitung für Firmen: [docs/password-manager.md](../../docs/password-manager.md). Die Extension nutzt die offizielle CLI des jeweiligen Anbieters (`keeper` aus Keeper Commander, `bw`, `op`); l8db sucht sie im `PATH`, in `/opt/homebrew/bin`, `/usr/local/bin` und `~/.local/bin`.

Aktivierung erfordert `process:execute` (die CLIs und Paketmanager aus `capabilities.process`), `connections:read` (Speichern im Tresor), `connections:write` (Laden aus dem Tresor, Entfernen entzogener Zugänge über `connections.remove`) und `filesystem:extension-storage` (merkt sich, welche Verbindungen aus dem Tresor stammen; ohne diese Freigabe werden entzogene Zugänge nicht entfernt).

Einrichtung: Nach dem Aktivieren zeigt die Karte der Extension einen Assistenten in drei Schritten: Passwortmanager wählen, CLI installieren, anmelden. Er nutzt den Befehl `vault.setup` (Payload `{ action: "status" | "install" | "login" | "logout", provider, … }`, Rückgabe ist der Status). Im Onboarding öffnet sich die Karte direkt nach der Installation, sonst liegt sie in den Einstellungen unter „Erweiterungen“.

- Bitwarden: Server (bitwarden.com, bitwarden.eu oder eigener), E-Mail und Master-Passwort; verlangt Bitwarden einen zweiten Faktor, fragt der Assistent den Code ab (Authenticator-App oder E-Mail). Alternativ Anmeldung per API-Schlüssel (`client_id`/`client_secret`), die auch die Bestätigung neuer Geräte umgeht. Ein gesperrter Tresor wird nur mit dem Master-Passwort entsperrt; die Sitzung bleibt im Speicher.
- 1Password: Anmeldung über die Desktop-App („Mit 1Password CLI integrieren“); bei mehreren Konten wird eines ausgewählt.
- Keeper: Region, E-Mail und Master-Passwort richten eine dauerhafte Anmeldung für das Gerät ein (`this-device register`, `persistent-login on`, `timeout 30d`). Verlangt Keeper eine Gerätefreigabe oder 2FA, fragt der Assistent sie direkt ab (Link per E-Mail, Keeper Push, Code per 2FA oder Bestätigungscode, danach die 2FA-Methode und den Code). Dafür läuft `keeper` über `process.start` in einem Pseudo-Terminal (Payload `{ action: "answer", method | channel | code }`). Nur bei Schritten wie SSO zeigt er die einmaligen Terminal-Befehle an.

Meldet Keeper bei der Anmeldung „Client Restricted“, muss die Keeper-Administration unter Rollen → betroffene Rolle → Enforcement Policies → Platform Restrictions den Zugriff auf **Commander SDK** prüfen. Bei mehreren Rollen kann die restriktivste Einstellung gelten. l8db kann diese Vorgabe nicht selbst ändern.

Danach direkt im Assistenten, über die Statusleiste oder in der Befehlspalette:

- `Passwortmanager: Zugänge abgleichen` (`vault.sync`, Payload `{ quiet: true }` liefert `{ total, added, updated, removed, hidden, skipped }` statt einer Meldung) übernimmt alle Einträge, deren Titel mit `l8db:` beginnt, auch aus geteilten Sammlungen, Tresoren und Ordnern. Läuft mit `vault.autoSync` (Standard an) auch beim Start (`onStartup`); ist der Tresor gesperrt, zeigt die Statusleiste einen Hinweis zum Entsperren. Verbindungen, die ein früherer Abgleich angelegt hat und die im Tresor fehlen, werden entfernt. Verbindungen, die schon vorher lokal existierten, bleiben immer erhalten. Wer eine Verbindung in l8db entfernt, blendet sie nur aus (`known_<anbieter>` in der Extension-Ablage); der Abgleich legt sie nicht erneut an. Passwörter landen nur im Sitzungsspeicher, nicht im Schlüsselbund.
- `vault.save` (Payload `{ id }`) legt die Verbindung als Login-Eintrag `l8db: <Name>` im persönlichen Tresor an oder aktualisiert den vorhandenen Eintrag (auch in geteilten Bereichen). Der Verbindungsdialog ruft ihn auf, wenn „In … speichern“ angehakt ist.
- `Passwortmanager: Bestehende Verbindungen speichern` (`vault.export`) macht dasselbe für mehrere ausgewählte Verbindungen.
- `Passwortmanager: Ausgeblendete Verbindungen einblenden` (`vault.import`) holt ausgeblendete Einträge zurück.
- Die Extension löscht nie Einträge im Passwortmanager und fragt nie nach einem Ziel-Tresor.

Einträge können auch direkt im Passwortmanager angelegt werden: Titel `l8db: <Name>`, Benutzername, Passwort und eine Datenbank-Adresse wie `postgres://host:5432/db` als Website. Erkannte Schemata: `postgres(ql)`, `mysql`, `mariadb`, `mssql`, `sqlserver`, `clickhouse`, `mongodb(+srv)`, `redis`, `rediss`, `valkey`, `oracle`, `cassandra`, `scylla`, `elasticsearch`, `opensearch`, `influxdb`, `libsql`, `snowflake`. Titel, Website, Benutzername und Passwort haben beim Laden Vorrang vor dem gespeicherten Profil. Einträge ohne Profil bekommen die ID `pm-<anbieter>-<eintrag>`.

CLI-Installation: Der Assistent zeigt die installierte CLI-Version oder „Jetzt installieren“ (auch als Befehl `Passwortmanager: CLI installieren`). l8db probiert die Paketmanager der Reihe nach und nimmt den ersten, der funktioniert:

- Keeper: `pipx`, Homebrew (`keeper-commander`), eigenes venv unter `~/.local/share/l8db/keeper`, `pip --user`, unter Windows `py -m pip` und winget (`KeeperSecurity.Commander`, landet unter `Program Files (x86)\Keeper Commander`)
- Bitwarden: `npm -g`, Homebrew, winget (`Bitwarden.CLI`)
- 1Password: Homebrew-Cask, winget (`AgileBits.1Password.CLI`), unter Linux der offizielle ZIP-Download nach `~/.local/bin`

Schlägt alles fehl, verweist die Meldung auf die offizielle Installationsanleitung.

Build: `bun run extension pack extention/password-manager extention/password-manager/l8db.password-manager-1.5.0.l8db-extension`

Browser-Test des ganzen Firmen-Ablaufs in der echten Sandbox: `L8DB_EXTENSION_BROWSER=1 bun test tests/password-manager-browser.test.ts`.

Live-Test gegen einen echten Bitwarden/Vaultwarden-Tresor: `L8DB_BW_MASTER_PASSWORD=… bun test tests/password-manager-live.test.ts` (eingeloggte `bw` im `PATH`).
