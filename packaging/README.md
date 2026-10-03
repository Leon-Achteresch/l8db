# Paket-Kanaele

Manifeste fuer die Distributionskanaele von l8db. **Das Publizieren ist bewusst manuell** -
hier liegen nur die Vorlagen, die pro Release aktualisiert und in das jeweilige Zielrepo
kopiert werden.

| Kanal | Datei(en) | Artefakt | Zielrepo |
| --- | --- | --- | --- |
| Homebrew (macOS) | `homebrew/l8db.rb` | `l8db_<version>_universal.dmg` | `Leon-Achteresch/homebrew-tap` |
| winget (Windows) | `winget/*.yaml` | `l8db_<version>_x64_en-US.msi` | `microsoft/winget-pkgs` (PR) |
| AUR (Arch Linux) | `aur/PKGBUILD`, `aur/.SRCINFO` | `l8db_<version>_amd64.deb` | `aur.archlinux.org/l8db-bin.git` |
| Flatpak (Linux) | `flatpak/com.leon.l8db.yml` | `l8db_<version>_amd64.deb` | `flathub/com.leon.l8db` (PR) |

## Woher die Artefaktnamen kommen

- `src-tauri/tauri.conf.json`: `productName: "l8db"`, `identifier: "com.leon.l8db"`,
  `bundle.targets: "all"`, `createUpdaterArtifacts: true`.
- `.github/workflows/release.yml`: Tags `v<version>`, Release-Name `l8db v<version>`,
  Matrix `macos-15` mit `universal-apple-darwin`, `windows-2025` mit
  `x86_64-pc-windows-msvc` und `ubuntu-22.04` mit `x86_64-unknown-linux-gnu`.
  Die stabile SemVer-Version steht vor dem Build im gemergten Release-PR.
- Tauri-Namensschema daraus:
  - macOS: `l8db_<version>_universal.dmg` (plus `l8db.app` im DMG)
  - Windows: `l8db_<version>_x64_en-US.msi` (WiX) und `l8db_<version>_x64-setup.exe` (NSIS)
  - Linux: `l8db_<version>_amd64.deb`, `l8db_<version>_amd64.AppImage`
- Updater: Der finale Verifikationsjob erzeugt `latest.json` einmal aus den
  geprueften Signaturen. Der Windows-Eintrag zeigt auf das NSIS-Setup.
  `latest.json` ist **nur** fuer den In-App-Updater, nicht fuer diese Kanaele.

> Die exakten Namen vor dem ersten Publizieren einmal gegen ein echtes Release pruefen:
> `gh release view v0.1.x --repo Leon-Achteresch/l8db --json assets --jq '.assets[].name'`

## sha256 ermitteln

Alle Manifeste enthalten `000...0`-Platzhalter (64 Nullen). Sie muessen pro Release durch die
echten Hashes ersetzt werden.

**Ohne Download**, direkt aus den Release-Metadaten (GitHub liefert seit 2025 pro Asset ein
`digest`-Feld):

```bash
gh api repos/Leon-Achteresch/l8db/releases/tags/v0.1.7 \
  --jq '.assets[] | "\(.digest // "kein digest")  \(.name)"'
```

**Mit Download** (immer moeglich, unabhaengig vom `digest`-Feld):

```bash
gh release download v0.1.7 --repo Leon-Achteresch/l8db --dir /tmp/l8db-0.1.7
shasum -a 256 /tmp/l8db-0.1.7/*        # macOS
sha256sum      /tmp/l8db-0.1.7/*        # Linux
certutil -hashfile l8db_0.1.7_x64_en-US.msi SHA256   # Windows
```

**Automatisch patchen** (siehe unten): `scripts/update-packaging.mjs`.

## Pro Release aktualisieren

| Datei | Felder |
| --- | --- |
| `homebrew/l8db.rb` | `version`, `sha256` (DMG) |
| `winget/LeonAchteresch.l8db.yaml` | `PackageVersion` |
| `winget/LeonAchteresch.l8db.installer.yaml` | `PackageVersion`, `InstallerUrl`, `InstallerSha256`, `ReleaseDate`, ggf. `ProductCode` |
| `winget/LeonAchteresch.l8db.locale.en-US.yaml` | `PackageVersion`, `ReleaseNotesUrl` |
| `aur/PKGBUILD` | `pkgver`, `pkgrel=1`, `sha256sums` (deb + LICENSE) |
| `aur/.SRCINFO` | wird aus dem PKGBUILD generiert |
| `flatpak/com.leon.l8db.yml` | `url` und `sha256` der deb-Quelle |

---

## Kanal 1: Homebrew Cask

Einmalig: Repo `Leon-Achteresch/homebrew-tap` anlegen (der Name **muss** mit `homebrew-` beginnen)
mit Ordner `Casks/`.

Pro Release:

```bash
# 1. Version/sha256 aktualisieren (manuell oder per Script)
node scripts/update-packaging.mjs --release release.json --metadata release-metadata.json

# 2. In den Tap kopieren
cp packaging/homebrew/l8db.rb ../homebrew-tap/Casks/l8db.rb

# 3. Lokal pruefen
brew audit --cask --new ../homebrew-tap/Casks/l8db.rb
brew style ../homebrew-tap/Casks/l8db.rb
brew install --cask ../homebrew-tap/Casks/l8db.rb
brew uninstall --cask l8db

# 4. Committen und pushen
```

Endnutzer: `brew tap Leon-Achteresch/tap && brew install --cask l8db`

Mit Homebrew 6 muss ein Cask aus einem Drittanbieter-Tap vor der Installation
einmal vertraut werden: `brew trust --cask Leon-Achteresch/tap/l8db`.

Hinweise:
- `sha256 :no_check` ist als Uebergang moeglich (im Cask dokumentiert), deaktiviert aber die
  Integritaetspruefung. Nur im eigenen Tap, nie fuer homebrew/cask.
- Der Release-Prozess signiert und notarisiert die App und prueft das DMG mit
  Gatekeeper. Das Cask entfernt das Quarantaene-Attribut nicht.
- Ein Eintrag in `homebrew/homebrew-cask` selbst verlangt zusaetzlich eine gewisse
  Projekt-Reichweite (Sterne/Alter) - der eigene Tap ist der realistische Weg.

## Kanal 2: winget

Voraussetzung: Microsoft-Konto mit GitHub-Fork von `microsoft/winget-pkgs`, optional
`wingetcreate` (`winget install Microsoft.WingetCreate`).

Bequemer Weg (erzeugt und validiert die Manifeste selbst, laedt das MSI und rechnet den Hash):

```powershell
wingetcreate update LeonAchteresch.l8db --version 0.1.7 `
  --urls https://github.com/Leon-Achteresch/l8db/releases/download/v0.1.7/l8db_0.1.7_x64_en-US.msi `
  --submit --token <github-pat>
```

Manueller Weg mit den Manifesten aus diesem Ordner:

```powershell
# 1. Fork klonen, Zielordner anlegen
#    manifests/l/LeonAchteresch/l8db/0.1.7/
# 2. Die drei YAMLs hineinkopieren und Version/URL/Hash setzen
# 3. Validieren und lokal testen
winget validate --manifest manifests\l\LeonAchteresch\l8db\0.1.7
winget install --manifest manifests\l\LeonAchteresch\l8db\0.1.7
# 4. Branch pushen und PR gegen microsoft/winget-pkgs oeffnen
```

Hinweise:
- Der erste PR erfordert zusaetzlich das `version`-Manifest; danach reicht pro Release ein neuer
  Versionsordner - alte Versionsordner bleiben stehen.
- Der Release-Prozess liest `ProductCode` aus dem gebauten MSI; das Hilfsscript
  uebernimmt ihn in das Installer-Manifest, damit winget das installierte Paket erkennt.
- Die Bundles sind nicht codesigniert. Die automatische Validierung von winget-pkgs meldet das
  (SmartScreen/Defender-Warnungen), blockiert aber nicht zwingend.

## Kanal 3: AUR

Voraussetzung: AUR-Konto mit hinterlegtem SSH-Key, `base-devel`, `pacman-contrib` (fuer
`updpkgsums`), `namcap`.

```bash
git clone ssh://aur@aur.archlinux.org/l8db-bin.git
cp packaging/aur/PKGBUILD l8db-bin/
cd l8db-bin

# Version setzen, Hashes ziehen, .SRCINFO regenerieren
updpkgsums
makepkg --printsrcinfo > .SRCINFO

# Bauen und pruefen
makepkg -si
namcap PKGBUILD
namcap l8db-bin-*.pkg.tar.zst

git add PKGBUILD .SRCINFO
git commit -m "upgpkg: l8db-bin 0.1.7-1"
git push
```

Hinweise:
- Paketname ist `l8db-bin`, weil ein Binaerartefakt installiert wird (AUR-Konvention).
- `.SRCINFO` niemals von Hand pflegen, immer `makepkg --printsrcinfo` - der Server lehnt einen
  Push mit abweichender `.SRCINFO` ab.
- Quelle ist bewusst das `.deb` und nicht das AppImage (Begruendung steht im PKGBUILD).
- `depends` sind aus `src-tauri/Cargo.lock` abgeleitet (webkit2gtk-4.1, libsecret fuer
  `keyring`). Nach dem ersten echten Build mit `namcap` gegenpruefen und korrigieren.

## Kanal 4: Flatpak / Flathub

Lokal bauen und testen (auf einem Linux-Rechner):

```bash
flatpak install -y flathub org.gnome.Platform//47 org.gnome.Sdk//47
flatpak install -y flathub org.flatpak.Builder
flatpak run org.flatpak.Builder --user --install --force-clean \
  build-dir packaging/flatpak/com.leon.l8db.yml
flatpak run com.leon.l8db
```

Submission:

1. `com.leon.l8db.metainfo.xml` (AppStream, inkl. Screenshots und `<releases>`) schreiben -
   ohne die Datei ist eine Submission chancenlos.
2. Fork von `flathub/flathub`, Branch `new-pr`, darin nur `com.leon.l8db.yml`
   (+ metainfo, + evtl. Offline-Sources) ablegen.
3. PR gegen `flathub/flathub`, Branch `new-pr` oeffnen. Der Bot baut und lintet.
4. Nach Freigabe wird `flathub/com.leon.l8db` angelegt; ab dann laeuft jedes Release ueber einen
   PR/Push in dieses Repo (Version + sha256 anpassen).

---

## Hilfsscript

`scripts/update-packaging.mjs` aktualisiert alle Vorlagen gemeinsam. Der unabhängige Workflow **Release follow-up** erzeugt nach einer verifizierten App-Veröffentlichung einen PR von `automation/packaging` nach `main`. Das Script benötigt die vom neuen Release-Prozess erzeugte `release-metadata.json`. Sie enthält geprüfte Artefakt-Hashes, den LICENSE-Hash und den tatsächlichen MSI ProductCode.

```sh
gh api repos/Leon-Achteresch/l8db/releases/tags/v0.8.25 > /tmp/l8db-release.json
gh release download v0.8.25 --repo Leon-Achteresch/l8db \
  --pattern release-metadata.json --dir /tmp/l8db-packaging
node scripts/update-packaging.mjs --release /tmp/l8db-release.json \
  --metadata /tmp/l8db-packaging/release-metadata.json --dry-run
```

Die Version im Beispiel durch den gewünschten neuen Release ersetzen. Ohne `--dry-run` werden die vorbereiteten Änderungen geschrieben. Releases vor der Einführung dieses Prozesses besitzen noch keine `release-metadata.json`.

Fehlende Installer, ungültige oder widersprüchliche Hashes, fremde Download-URLs, ein falscher LICENSE-Hash, ein fehlender MSI ProductCode oder eine unvollständige Vorlage lassen das Script vor jeder Dateiveränderung fehlschlagen. Es gibt keinen Fallback auf alte Hashes. Bei lokalen Artefakten können `--artifacts` beziehungsweise `--checksums` die Hashes liefern; sie müssen weiterhin zu den Release-Metadaten passen. `--license-file` akzeptiert die lokale LICENSE des Tags und prüft ihren Hash.

Die Vorlagen im Repository werden nicht automatisch in Homebrew-Tap, winget-pkgs, AUR oder Flathub veröffentlicht. Die Schritte zur externen Einreichung oben bleiben gültig. Der Flatpak-Eintrag bleibt bis zur Behebung der dort beschriebenen offenen Punkte eine Vorlage.
