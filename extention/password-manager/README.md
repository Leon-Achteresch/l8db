# Passwortmanager-Sync

Stellt Datenbank-Zugänge aus Keeper, Bitwarden oder 1Password direkt in l8db bereit und speichert l8db-Verbindungen dort, auch in geteilten Sammlungen, Tresoren und Ordnern für ganze Teams. Anleitung für Firmen: [docs/password-manager.md](../../docs/password-manager.md). Die Extension nutzt die offizielle CLI des jeweiligen Anbieters (`keeper` aus Keeper Commander, `bw`, `op`); l8db sucht sie im `PATH`, in `/opt/homebrew/bin`, `/usr/local/bin` und `~/.local/bin`.

Aktivierung erfordert `process:execute` (die CLIs und Paketmanager aus `capabilities.process`), `connections:read` (Speichern im Tresor), `connections:write` (Laden aus dem Tresor, Entfernen entzogener Zugänge über `connections.remove`) und `filesystem:extension-storage` (merkt sich, welche Verbindungen aus dem Tresor stammen; ohne diese Freigabe werden entzogene Zugänge nicht entfernt).

Einrichtung: In den Einstellungen unter „Erweiterungen“ zeigt die Karte nach dem Aktivieren einen Assistenten in drei Schritten: Passwortmanager wählen, CLI installieren, anmelden. Er nutzt den Befehl `vault.setup` (Payload `{ action: "status" | "install" | "login" | "logout", provider, … }`, Rückgabe ist der Status).

- Bitwarden: Server (bitwarden.com, bitwarden.eu oder eigener), E-Mail und Master-Passwort; verlangt Bitwarden einen zweiten Faktor, fragt der Assistent den Code ab (Authenticator-App oder E-Mail). Alternativ Anmeldung per API-Schlüssel (`client_id`/`client_secret`), die auch die Bestätigung neuer Geräte umgeht. Ein gesperrter Tresor wird nur mit dem Master-Passwort entsperrt; die Sitzung bleibt im Speicher.
- 1Password: Anmeldung über die Desktop-App („Mit 1Password CLI integrieren“); bei mehreren Konten wird eines ausgewählt.
- Keeper: Region, E-Mail und Master-Passwort richten eine dauerhafte Anmeldung für das Gerät ein (`this-device register`, `persistent-login on`, `timeout 30d`). Verlangt Keeper eine Gerätefreigabe oder 2FA, zeigt der Assistent die einmaligen Terminal-Befehle an.

Danach in der Befehlspalette, in der Statusleiste oder direkt im Assistenten:

- `Passwortmanager: Zugänge abgleichen` (`vault.sync`, Payload `{ quiet: true }` liefert `{ total, added, updated, removed, skipped }` statt einer Meldung) übernimmt alle Einträge, deren Titel mit `l8db:` beginnt. Läuft mit `vault.autoSync` (Standard an) auch beim Start (`onStartup`); ist der Tresor gesperrt, zeigt die Statusleiste einen Hinweis zum Entsperren. Verbindungen, die ein früherer Abgleich angelegt hat und die im Tresor fehlen, werden entfernt. Verbindungen, die schon vorher lokal existierten, bleiben immer erhalten.
- `Passwortmanager: Verbindungen freigeben` legt pro Verbindung einen Login-Eintrag `l8db: <Name>` an (Benutzer, Passwort, Adresse ohne Passwort als Website, Profil in den Notizen) bzw. aktualisiert ihn. Für neue Einträge fragt l8db nach dem Ziel: persönlicher Tresor oder geteilter Bereich (Bitwarden-Sammlung via `organizationId`/`collectionIds`, 1Password-Tresor via `--vault`, Keeper-Ordner aus `list-sf` via `--folder`).
- `Passwortmanager: Einzelne Verbindungen laden` übernimmt ausgewählte Einträge ohne Abgleich.

Einträge können auch direkt im Passwortmanager angelegt werden: Titel `l8db: <Name>`, Benutzername, Passwort und eine Datenbank-Adresse wie `postgres://host:5432/db` als Website. Erkannte Schemata: `postgres(ql)`, `mysql`, `mariadb`, `mssql`, `sqlserver`, `clickhouse`, `mongodb(+srv)`, `redis`, `rediss`, `valkey`, `oracle`, `cassandra`, `scylla`, `elasticsearch`, `opensearch`, `influxdb`, `libsql`, `snowflake`. Titel, Website, Benutzername und Passwort haben beim Laden Vorrang vor dem gespeicherten Profil. Einträge ohne Profil bekommen die ID `pm-<anbieter>-<eintrag>`.

CLI-Installation: Die Seitenleiste „Passwortmanager“ zeigt pro Anbieter die installierte CLI-Version oder einen „Installieren“-Button (auch als Befehl `Passwortmanager: CLI installieren`). l8db probiert die Paketmanager der Reihe nach und nimmt den ersten, der funktioniert:

- Keeper: `pipx`, `pip --user`, eigenes venv unter `~/.local/share/l8db/keeper`, unter Windows `py -m pip`
- Bitwarden: `npm -g`, Homebrew, winget (`Bitwarden.CLI`)
- 1Password: Homebrew-Cask, winget (`AgileBits.1Password.CLI`), unter Linux der offizielle ZIP-Download nach `~/.local/bin`

Schlägt alles fehl, verweist die Meldung auf die offizielle Installationsanleitung.

Build: `bun run extension pack extention/password-manager extention/password-manager/l8db.password-manager-1.2.0.l8db-extension`

Browser-Test des ganzen Firmen-Ablaufs in der echten Sandbox: `L8DB_EXTENSION_BROWSER=1 bun test tests/password-manager-browser.test.ts`.

Live-Test gegen einen echten Bitwarden/Vaultwarden-Tresor: `L8DB_BW_MASTER_PASSWORD=… bun test tests/password-manager-live.test.ts` (eingeloggte `bw` im `PATH`).
