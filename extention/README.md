# Jev Plan-Diagnose

Diese offizielle l8db-Extension ergänzt die EXPLAIN-Ansicht um eine optionale TypeSafe-Jev-Diagnose. Sie ist nach der Installation deaktiviert. Zur Aktivierung braucht sie `network` für `api.typesafe.ai` und `filesystem:extension-storage` für einen eigenen API-Schlüssel im OS-Schlüsselbund.

`Mit Jev prüfen` zeigt vor jedem Aufruf die vollständige Anfrage an. Sie enthält nur fest definierte Knotenkategorien, Größenklassen und Wahrheitswerte. SQL, Tabellen- und Spaltennamen, Filtertexte, Datenbankzeilen und Verbindungsdaten werden nicht an TypeSafe übergeben. TypeSafe erhält beim Aufruf weiterhin Netzwerk- und Nutzungsdaten gemäß den eigenen Bedingungen.

Die Extension klassifiziert den Plan als optimal, verbesserungswürdig oder nicht optimal; l8db zeigt das Ergebnis als Marker direkt am Statement im Editor. Sie ändert oder startet keine Abfrage. Der Schlüssel lässt sich über `Jev: API-Schlüssel löschen` entfernen und wird bei der Deinstallation aus dem OS-Schlüsselbund gelöscht.

Build: `bun run extension pack extention extention/l8db.jev-1.0.0.l8db-extension`

Beim Schreiben im Query-Editor prüft l8db das aktuelle Statement nach kurzer Pause automatisch (EXPLAIN ohne ANALYZE) und übergibt die Planmerkmale an Jev. Vor der ersten automatischen Prüfung fragt die Extension einmalig um Erlaubnis; danach entfällt die Einzelbestätigung. Umschalten über `Jev: Automatische Prüfung umschalten`.
