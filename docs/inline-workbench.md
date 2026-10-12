# Inline bearbeiten und Arbeitsbereiche

Umbenennen im Explorer funktioniert für Tabellen und Views über das Kontextmenü oder F2. Enter übernimmt, Escape bricht ab. Fehler stehen an der Eingabe. Offene Objekt-Tabs wechseln auf den neuen Namen. Löschen und Leeren bleiben modal und verlangen den Namen zur Bestätigung.

Vergleich einrichten, Snippets, Tastenkürzel, Debugger, Testdaten, Index-, Constraint-, Policy-, Rollen- und Enum-Editor sowie die DDL-Vorschau für Schema-Kopien öffnen Arbeitsbereich-Tabs. Der Schema-Vergleich zeigt seine Einrichtung innerhalb seines bestehenden Tabs. Constraints für neue Tabellen werden direkt im Tabellenentwurf bearbeitet.

`asWorkbenchTab` übergibt die Form an `WorkbenchHost`. Der Host bleibt oberhalb der Routen montiert und rendert in einen stabilen Portal-Container. `WorkbenchView` hängt diesen Container in die aktuelle Ansicht oder einen Split-Bereich ein. Dadurch bleiben lokale Eingaben, Debugger-Sitzungen und laufende Aktionen bei Tab-Wechseln erhalten. Verbindung und Datenbank sind auf den Ursprung des Formulars festgelegt.

Diese Arbeitsbereiche leben für die aktuelle Fenstersitzung. Sie werden weder in localStorage noch in der Liste geschlossener Tabs abgelegt; dazu gehören auch Kennwörter in Rollenformularen. Schließen verwirft das Formular, ein Neustart öffnet es nicht erneut. Während einer laufenden Aktion verhindert die Tab-Schließfunktion das Schließen. Destruktive DDL-Vorschauen verwenden weiterhin den modalen Dialog.
