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
