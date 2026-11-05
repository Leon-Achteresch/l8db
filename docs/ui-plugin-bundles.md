# UI-Plugins übertragen

Unter Einstellungen → Erweiterungen → UI-Plugins mit **Exportieren** alle oder
 einzelne Plugins auswählen und als JSON speichern. Auf der anderen Maschine
**Importieren** wählen, Code und Diff prüfen und die Auswahl übernehmen.
Abbrechen verändert keine Plugin-Datei. Nicht ausgewählte Dateien bleiben erhalten.
Ein fehlerhafter Eintrag verhindert den Import der übrigen Auswahl nicht.

Optionen werden übertragen und ersetzen die bisherigen Optionen des importierten
Plugins. Sie können vertrauliche Werte enthalten: die Datei vor dem Teilen prüfen.
HTTP-Freigaben werden nie übertragen; benötigte Hosts werden aus dem geprüften
Quelltext angezeigt. Für importierte IDs werden bestehende Freigaben entzogen;
neue Freigaben erfolgen separat in der Plugin-Karte.
Die Einstellungen verwenden weiterhin die bestehende Synchronisation über
l8db.ui-plugins; Dateien aktualisieren andere Fenster über den bestehenden Watcher.

Das JSON-Format ist { "format": "l8db.ui-plugins", "version": 1, "plugins": [...] }.
Jeder Eintrag enthält name, source, options und requiredHttpHosts.
Grenzen: 2 MiB pro Datei, 200 Einträge, 256 KiB Quelltext pro Plugin.
Flache Dateinamen folgen denselben Regeln wie der Plugin-Ordner; doppelte Namen
werden ohne Beachtung der Großschreibung abgelehnt. Unbekannte Formatversionen
werden abgewiesen. Compilerfehler werden vor jedem Schreiben geprüft.

Das Extension-Archiv in packages/extension-api/src/manifest.ts beschreibt eine
 einzelne Erweiterung mit format: 1, manifest und files. UI-Bundles übertragen
mehrere leichte Erweiterungen mit lokalen Optionen. Ein eigener Formattyp vermeidet
 eine mehrdeutige Interpretation; Schritt D kann beide Typen in einem gemeinsamen
versionierten Container aufnehmen. Es erfolgt keine automatische Verteilung.

## Gemeinsame Erweiterungsverwaltung

Einstellungen → Erweiterungen führt die Stufen **Leicht** (bisher UI-Plugin) und
**Voll** (Extension mit Manifest und Worker im Sandbox-Iframe) in einer paginierten
Liste zusammen. Optionen, HTTP-Freigaben, Aktivierung, Entfernen, Galerie,
KI-Anleitung und Entwicklungsordner bleiben verfügbar. Beide Laufzeiten bleiben getrennt.

Das bisherige JSON-Format `l8db.ui-plugins`, Version 1, erhält optional `archives`:
eine Liste unveränderter Archive aus `packages/extension-api`. Dies ist eine additive,
abwärtslesbare Erweiterung statt einer Migration: bisherige Bundles ohne dieses Feld
bleiben gültig; bisherige Leser importieren weiterhin deren leichte Einträge.
Das bestehende Gesamtlimit von 2 MiB sowie maximal 200 leichte und 50 volle Einträge
bleiben bewusst begrenzt. Größere volle Pakete lassen sich einzeln installieren.

Der Import zeigt Permissions und Netzwerk-/Prozessziele voller Archive. Diese sind
anfangs nicht ausgewählt. Die Auswahl bestätigt die Installation, die zunächst
ausgeschaltet erfolgt. Erst die separate Rechtefreigabe aktiviert die Erweiterung.
Abbrechen installiert nichts. Bereits installierte volle IDs werden abgewiesen;
Updates erfolgen über die vorhandene Aktualisierung. Gleiche IDs zwischen den beiden
Stufen sind zulässig, innerhalb einer Stufe bleiben sie eindeutig. Freigaben und
Secrets werden nicht exportiert, Konfiguration voller Erweiterungen ebenfalls nicht.

Die Organisationsregel `allowExtensions` gilt für beide Stufen einschließlich KI,
Galerie, Import und Aktivierung. Alte Storage-Keys bleiben erhalten. Die zusätzliche
Herkunft wird unter `l8db.extension-sources` mit stufenspezifischen Schlüsseln gespeichert
und zwischen Fenstern synchronisiert. Alte Galerieeinträge leichter Erweiterungen
werden anhand der vorhandenen Installationsmetadaten erkannt; sonstige ältere Einträge
erscheinen als Eigene, da ihre ursprüngliche Herkunft nicht rekonstruierbar ist.
Volle Installationen und Änderungen werden über ein Storage-Ereignis abgeglichen,
leichte weiterhin über ihren Datei-Watcher; es gibt kein zusätzliches Polling.
