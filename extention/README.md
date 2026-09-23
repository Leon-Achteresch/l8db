# Jev Plan-Diagnose

Diese offizielle l8db-Extension ergänzt die EXPLAIN-Ansicht um eine optionale TypeSafe-Jev-Diagnose. Sie ist nach der Installation deaktiviert. Zur Aktivierung braucht sie `network` für `api.typesafe.ai` und `filesystem:extension-storage` für einen eigenen API-Schlüssel im OS-Schlüsselbund.

`Mit Jev prüfen` zeigt vor jedem Aufruf die vollständige Anfrage an. Sie enthält nur fest definierte Knotenkategorien, Größenklassen und Wahrheitswerte. SQL, Tabellen- und Spaltennamen, Filtertexte, Datenbankzeilen und Verbindungsdaten werden nicht an TypeSafe übergeben. TypeSafe erhält beim Aufruf weiterhin Netzwerk- und Nutzungsdaten gemäß den eigenen Bedingungen.

Die Extension gibt einen Hinweis aus und ändert oder startet keine Abfrage. Der Schlüssel lässt sich über `Jev: API-Schlüssel löschen` entfernen und wird bei der Deinstallation aus dem OS-Schlüsselbund gelöscht.

Build: `bun run extension pack extention extention/l8db.jev-1.0.0.l8db-extension`
