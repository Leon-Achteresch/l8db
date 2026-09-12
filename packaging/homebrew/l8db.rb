# Homebrew-Cask fuer l8db.
#
# Zielort: Tap-Repo "Leon-Achteresch/homebrew-tap" als Casks/l8db.rb
# Installation fuer Endnutzer:
#   brew tap Leon-Achteresch/tap
#   brew install --cask l8db
#
# Artefakt: das Universal-DMG aus dem Release-Workflow
# (.github/workflows/release.yml baut macOS mit --target universal-apple-darwin,
#  Tauri benennt das Bundle deshalb "<productName>_<version>_universal.dmg").
#
# PRO RELEASE ZU AKTUALISIEREN: version + sha256.
# Der sha256-Wert unten ist ein PLATZHALTER und muss vor dem ersten echten
# Push durch den Hash des veroeffentlichten DMG ersetzt werden:
#   shasum -a 256 l8db_<version>_universal.dmg
#   # oder ohne Download:
#   brew fetch --cask ./l8db.rb
#
# ALTERNATIVE OHNE HASH (nur als Uebergangsloesung in einem privaten Tap,
# von Homebrew fuer offizielle Casks NICHT akzeptiert):
#   sha256 :no_check
# Damit prueft Homebrew die Integritaet des Downloads nicht mehr. Sinnvoll nur,
# solange die Release-Artefakte noch nicht stabil sind; danach echten Hash setzen.

cask "l8db" do
  version "0.4.1"
  sha256 "96bff31fea5b60569236aa348053385cbc5092ac6a875eb7f07fc77e97f55749"

  url "https://github.com/Leon-Achteresch/l8db/releases/download/v#{version}/l8db_#{version}_universal.dmg"
  name "l8db"
  desc "Fast, native desktop client for PostgreSQL and other databases"
  homepage "https://github.com/Leon-Achteresch/l8db"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Die App bringt den Tauri-Updater mit (plugins.updater in tauri.conf.json),
  # aktualisiert sich also selbst. Deshalb meldet brew sie nicht als "outdated".
  auto_updates true

  depends_on macos: :monterey

  app "l8db.app"

  zap trash: [
    "~/Library/Application Support/com.leon.l8db",
    "~/Library/Caches/com.leon.l8db",
    "~/Library/HTTPStorages/com.leon.l8db",
    "~/Library/Preferences/com.leon.l8db.plist",
    "~/Library/Saved Application State/com.leon.l8db.savedState",
    "~/Library/WebKit/com.leon.l8db",
  ]
end
