# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 8: SQL-Herkunft bleibt vorn, NULL-Unterscheidung kommt hinzu. Der Beziehungsfilter bleibt schwächer belegt; Spaltenexport ist weiter abgeschlossen.**

1. **Gespeicherte SQL-Abfragen mit Herkunft.** Verbindung und Datenbank an gespeicherten Abfragen erleichtern die Auswahl ähnlicher Skripte. Ein [direkter Nutzerwunsch vom Oktober 2026](https://github.com/dbeaver/dbeaver/issues/42275) stützt die Aufgabe; l8db hat diesen Kontext bereits im Verlauf, aber nicht bei benannten gespeicherten Abfragen. Wie häufig die Ergänzung gebraucht wird, bleibt offen.

2. **SQL-NULL und JSON-null unterscheiden.** Eine getrennte Anzeige macht unterschiedliche Filterergebnisse verständlich. Ein [MySQL-Nutzerbericht vom September 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) beschreibt die Verwechslung. Im statisch geprüften l8db-MySQL-Pfad werden beide Werte zusammengeführt; eine Laufzeitbestätigung fehlt.

3. **Über Kindtabellen filtern – nachrangig.** Ein solcher Filter könnte Nutzer anhand einer E-Mail-Adresse in ihrer Adresstabelle finden. Der JOIN-Builder kann den Suchweg bereits abbilden; der Zusatz wäre die eindeutige Elternliste direkt in der Tabellenansicht. Zum [bisherigen Supportwunsch](https://github.com/beekeeper-studio/beekeeper-studio/issues/5055) wurde kein unabhängiger aktueller Nutzerfall gefunden.

[Neue Evidenz und Gegenprüfung](sources.md#runde-8--beziehungsfilter-gegen-join-builder-und-null-arten) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Weitere unabhängige Originalfälle zur NULL-Unterscheidung und bestehende Lösungen anderer Clients.
