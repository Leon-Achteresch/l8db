# Passwortmanager-Sync

Lädt l8db-Verbindungen aus Keeper, Bitwarden oder 1Password und speichert sie dort. Die Extension nutzt die offizielle CLI des jeweiligen Anbieters (`keeper` aus Keeper Commander, `bw`, `op`); l8db sucht sie im `PATH`, in `/opt/homebrew/bin`, `/usr/local/bin` und `~/.local/bin`.

Aktivierung erfordert `process:execute` (die CLIs und Paketmanager aus `capabilities.process`), `connections:read` (Speichern im Tresor) und `connections:write` (Laden aus dem Tresor).

Einrichtung: In den Einstellungen unter „Erweiterungen“ zeigt die Karte nach dem Aktivieren einen Assistenten in drei Schritten: Passwortmanager wählen, CLI installieren, anmelden. Er nutzt den Befehl `vault.setup` (Payload `{ action: "status" | "install" | "login" | "logout", provider, … }`, Rückgabe ist der Status).

- Bitwarden: Server (bitwarden.com, bitwarden.eu oder eigener), E-Mail und Master-Passwort; verlangt Bitwarden einen zweiten Faktor, fragt der Assistent den Code ab (Authenticator-App oder E-Mail). Alternativ Anmeldung per API-Schlüssel (`client_id`/`client_secret`), die auch die Bestätigung neuer Geräte umgeht. Ein gesperrter Tresor wird nur mit dem Master-Passwort entsperrt; die Sitzung bleibt im Speicher.
- 1Password: Anmeldung über die Desktop-App („Mit 1Password CLI integrieren“); bei mehreren Konten wird eines ausgewählt.
- Keeper: Region, E-Mail und Master-Passwort richten eine dauerhafte Anmeldung für das Gerät ein (`this-device register`, `persistent-login on`, `timeout 30d`). Verlangt Keeper eine Gerätefreigabe oder 2FA, zeigt der Assistent die einmaligen Terminal-Befehle an.

Danach in der Befehlspalette oder direkt im Assistenten:

- `Passwortmanager: Verbindungen speichern` legt pro Verbindung einen Login-Eintrag `l8db: <Name>` an (Benutzer, Passwort, Profil in den Notizen) bzw. aktualisiert ihn.
- `Passwortmanager: Verbindungen laden` übernimmt ausgewählte Einträge; bestehende Verbindungen werden anhand ihrer ID bzw. Name/Typ/URL aktualisiert, Passwörter landen im OS-Schlüsselbund.

CLI-Installation: Die Seitenleiste „Passwortmanager“ zeigt pro Anbieter die installierte CLI-Version oder einen „Installieren“-Button (auch als Befehl `Passwortmanager: CLI installieren`). l8db probiert die Paketmanager der Reihe nach und nimmt den ersten, der funktioniert:

- Keeper: `pipx`, `pip --user`, eigenes venv unter `~/.local/share/l8db/keeper`, unter Windows `py -m pip`
- Bitwarden: `npm -g`, Homebrew, winget (`Bitwarden.CLI`)
- 1Password: Homebrew-Cask, winget (`AgileBits.1Password.CLI`), unter Linux der offizielle ZIP-Download nach `~/.local/bin`

Schlägt alles fehl, verweist die Meldung auf die offizielle Installationsanleitung.

Build: `bun run extension pack extention/password-manager extention/password-manager/l8db.password-manager-1.1.0.l8db-extension`

Live-Test gegen einen echten Bitwarden/Vaultwarden-Tresor: `L8DB_BW_MASTER_PASSWORD=… bun test tests/password-manager-live.test.ts` (eingeloggte `bw` im `PATH`).
