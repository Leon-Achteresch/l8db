# l8db · Feature-Recherche · 14. November 2026

**Zyklus 1 abgeschlossen: zwei Rechercherunden, 21 Quellen, acht geprüfte Kandidaten, drei interaktive Mockups.** Nur Forschung und Konzepte; keine Produktimplementierung.

## Entscheidung

1. **[Export mit Herkunft und Beleg](mockups/01-export-beleg.html)** – geladene Teilmenge und neue Abfrage klar unterscheiden; Limits bleiben nach dem Export sichtbar. Beste Kombination aus Evidenz, Nutzen und überschaubarem Zusatzaufwand.
2. **[Verbindungsdiagnose](mockups/02-verbindungsdiagnose.html)** – Netzwerk/SSH/TLS/Anmeldung auseinanderhalten. Vorhandenes Reconnect ergänzen, keine Nutzerabfrage automatisch wiederholen.
3. **[Import-Prüflauf](mockups/03-import-prueflauf.html)** – lokale Datei-/Typfehler vor dem Schreiben sammeln. „Keine lokalen Fehler“ garantiert keine Datenbank-Constraints.

**Runde 2:** Import ersetzt lokale Beziehungen in den Top 3. Deren Nachfragebeleg ist alt; DataGrip bietet sie bereits. Auch Export ohne Neuausführung ist bei DBeaver inzwischen bearbeitet – l8db gewinnt hier durch klaren Ablauf, nicht durch behauptete Einzigartigkeit.

**Dubletten vermieden:** Arbeitsstände, SQL-/Ergebnisstände, Planvergleich, Zeitdarstellung, Spaltenprofile, Cloud-Login und Maskierung existieren bereits. Ältere Roadmap-Dokumente widersprechen teilweise dem aktuellen Code.

[Quellen und Gegenbelege](sources.md) · [Backlog mit Codeprüfung](backlog.md) · [Top-3-MVPs und Abnahme](concepts.md) · [Mockup-Prüfung](validation.md)

**Offen:** keine l8db-Nutzerinterviews, keine Nachfragehäufigkeit oder Zahlungsbereitschaft belegt; GitHub und technische englischsprachige Nutzer überrepräsentiert. Öffentlicher Roadmap-Feed beim Abruf 404. Niedrigere Backlogplätze bleiben Hypothesen.

**Nächster Fokus:** Exportverständnis gegen aktuelle Konkurrenzabläufe prüfen und weitere unabhängige Fälle aus 2026 suchen. Später autorisierte Nutzertests: verstehen Nutzer Teilmenge, neuen Snapshot und Limitbeleg richtig?
