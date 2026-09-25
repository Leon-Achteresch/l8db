# Passwortmanager-Sync

Lädt l8db-Verbindungen aus Keeper, Bitwarden oder 1Password und speichert sie dort. Die Extension nutzt die offizielle CLI des jeweiligen Anbieters (`keeper` aus Keeper Commander, `bw`, `op`); l8db sucht sie im `PATH`, in `/opt/homebrew/bin`, `/usr/local/bin` und `~/.local/bin`.

Aktivierung erfordert `process:execute` (nur `keeper`, `bw`, `op`), `connections:read` (Speichern im Tresor) und `connections:write` (Laden aus dem Tresor). Anbieter über die Einstellung `vault.provider` wählen, dann in der Befehlspalette:

- `Passwortmanager: Verbindungen speichern` legt pro Verbindung einen Login-Eintrag `l8db: <Name>` an (Benutzer, Passwort, Profil in den Notizen) bzw. aktualisiert ihn.
- `Passwortmanager: Verbindungen laden` übernimmt ausgewählte Einträge; bestehende Verbindungen werden anhand ihrer ID bzw. Name/Typ/URL aktualisiert, Passwörter landen im OS-Schlüsselbund.

CLI-Installation: Die Seitenleiste „Passwortmanager“ zeigt pro Anbieter die installierte CLI-Version oder einen „Installieren“-Button (auch als Befehl `Passwortmanager: CLI installieren`). l8db probiert die Paketmanager der Reihe nach und nimmt den ersten, der funktioniert:

- Keeper: `pipx`, `pip --user`, eigenes venv unter `~/.local/share/l8db/keeper`, unter Windows `py -m pip`
- Bitwarden: `npm -g`, Homebrew, winget (`Bitwarden.CLI`)
- 1Password: Homebrew-Cask, winget (`AgileBits.1Password.CLI`), unter Linux der offizielle ZIP-Download nach `~/.local/bin`

Schlägt alles fehl, verweist die Meldung auf die offizielle Installationsanleitung.

Voraussetzungen: Keeper Commander mit persistentem Login (`keeper shell` → `this-device persistent-login on`), Bitwarden `bw login` (Entsperren fragt l8db per Master-Passwort ab, die Sitzung bleibt nur im Speicher), 1Password `op` mit Desktop-App-Integration oder `op signin`.

Build: `bun run extension pack extention/password-manager extention/password-manager/l8db.password-manager-1.0.0.l8db-extension`

Live-Test gegen einen echten Bitwarden/Vaultwarden-Tresor: `L8DB_BW_MASTER_PASSWORD=… bun test tests/password-manager-live.test.ts` (eingeloggte `bw` im `PATH`).
