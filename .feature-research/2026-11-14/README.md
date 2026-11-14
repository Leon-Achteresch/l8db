# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 7: Zwei neue Prüfkandidaten; für drei starke neue Ideen reicht die Evidenz nicht. Der Spaltenexportpfad ist vorerst abgeschlossen.**

1. **Gespeicherte SQL-Abfragen mit Herkunft.** Verbindung und Datenbank an gespeicherten Abfragen erleichtern die Auswahl ähnlicher Skripte. Ein [direkter Nutzerwunsch vom Oktober 2026](https://github.com/dbeaver/dbeaver/issues/42275) stützt die Aufgabe; l8db hat diesen Kontext bereits im Verlauf, aber nicht bei benannten gespeicherten Abfragen. Wie häufig die Ergänzung gebraucht wird, bleibt offen.

2. **Über verknüpfte Datensätze filtern.** Ein Filter über verknüpfte Tabellen findet etwa Nutzer anhand ihrer separat gespeicherten E-Mail-Adresse. l8db hat bereits FK-Navigation und einen JOIN-Builder; neu wäre der Filter über eingehende Beziehungen direkt in der Tabellenansicht. Ein [Supportwunsch vom November 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/5055) stützt die Aufgabe, eine unabhängige Bestätigung fehlt.

[Neue Originalfälle und Gegenprüfung](sources.md#runde-7--gespeicherte-abfragen-zuordnen-und-alltagsprobleme-prüfen) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Unabhängige Nutzerfälle für Filter über Kindtabellen und Gegenprüfung am vorhandenen JOIN-Builder.
