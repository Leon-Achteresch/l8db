# TableJSONViewer

Community-Extension für Tabellen, die ein JSON-Dokument als einzelne Knoten speichern. Die Extension setzt alle Zeilen des aktiven Tabellenfilters zusammen und öffnet den eingebauten l8db-JSON-Viewer mit Baum, Code und Tabelle. Der Viewer unterstützt Suche, Kopieren und Speichern als JSON-Datei.

## Installation und Verwendung

1. `leon-achteresch.table-json-viewer-0.1.0.l8db-extension` unter Einstellungen → Community-Extensions importieren. Das Paket benötigt die hier ergänzte l8db-Version mit `table/toolbar` und `panels.openJson`.
2. Die Extension aktivieren und Datenbank-Lesezugriff sowie eigenen Einstellungsspeicher erlauben.
3. Eine Tabelle oder View öffnen und zum Beispiel auf `REF_KOPF = 10271` filtern.
4. Das Drei-Punkte-Menü der Tabelle öffnen und das Symbol mit geschweiften Klammern (**TableJSONViewer**) wählen.
5. Bei abweichenden Spaltennamen im selben Menü das Einstellungssymbol (**TableJSONViewer: Spalten zuordnen**) wählen. Die Zuordnung wird pro Verbindung, Datenbank und Tabelle gespeichert.

Die Extension benötigt weder Netzwerkzugriff noch Datenbank-Schreibrechte. Datenbankzugänge werden nicht an die Extension übergeben. Der Zusammenbau läuft im Extension-Sandbox-Worker; die Anzeige nutzt den nativen JSON-Viewer.

## Tabellenmodell

| Spalte | Verwendung |
| --- | --- |
| `EBENE` | Verschachtelungstiefe, ganze Zahl zwischen 0 und 128 |
| `POS_NR` | Numerische Reihenfolge innerhalb eines Dokuments |
| `WERT_NAME` | JSON-Schlüssel |
| `WERT_INHALT` | Wert; Texte und SQL-NULL bleiben erhalten |
| `WERT_CLOB` | Ersatz, wenn `WERT_INHALT` SQL-NULL ist |
| `REF_KOPF` | Trennt Dokumente; optional |
| `SUBTAG` | Ein Wert größer als 0 kennzeichnet einen Objektknoten, auch ohne Kinder; optional |

`REF` und `WERT_ATTR` werden für den JSON-Zusammenbau nicht ausgewertet. Die Bedeutung von Attributen und expliziten Array-Markierungen muss bei Bedarf anhand der echten Tabelle ergänzt werden. Wiederholte Namen unter demselben Elternknoten werden zu einem Array; mehrere `REF_KOPF`-Werte ergeben ein Array aus Dokumenten. Eine einzelne Dokumentgruppe ergibt ein Objekt.

Die Zeilen werden vor dem Zusammenbau nach `POS_NR` sortiert. Die kleinste vorhandene Ebene bildet die Wurzelebene; Filter können dadurch auch einen Teilbaum anzeigen. Fehlende Elternknoten innerhalb der Hierarchie sowie Knoten mit gleichzeitigem Wert und Unterknoten werden als Fehler gemeldet. Leere Strings bleiben leere Strings; sie ersetzen keine NULL-Werte. Zahlenähnliche Texte, Datumswerte und JSON-Texte in CLOBs bleiben Strings.

Für die bereitgestellten Beispieldaten entsteht:

```json
{
  "DeliveryOrderResponse": {
    "Location": "Meppen",
    "Warehouse": "Meppen",
    "Client": "buah",
    "OrderStatus": "planed",
    "OrderNumber": "2026DE1733663",
    "OrderReferenz": null,
    "OrderCommNumber": null,
    "PurchaseNumber": null,
    "DeliveryNoteNumber": "LS102082020",
    "DeliveryDate": "2026-09-30",
    "ProcessTimestamp": "2026-10-02T13:24:45+02:00"
  }
}
```

Der Tabellenzugriff berücksichtigt Filtermodus, Sortierung, aktive Transaktion und SSH-Tunnel. Er ist für SQL-Datenbanken einschließlich Oracle verfügbar und benötigt keinen vollständigen Tabellenexport. Es werden höchstens 50.000 Zeilen und 4 MiB Snapshot-Daten übernommen. Bei Überschreitung oder unvollständigem Abruf wird abgebrochen; es wird kein gekürztes Dokument als vollständige JSON angezeigt. Ändert sich die Zeilenzahl während des Abrufs, muss erneut geladen werden. Ohne aktive Transaktion ist der Abruf kein garantierter Datenbank-Snapshot.

## Entwicklung

### Testdatenbank

Das mitgelieferte `IFC_SENDEN_POS.sql` enthält die INSERTs für ein Dokument mit `REF_KOPF = 8292`. Eine separate SQLite-Datei mit den neun Originalspalten wird so angelegt:

```sh
bun extention/table-json-viewer/create-test-database.ts
```

Die Datei liegt unter `test-artifacts/table-json-viewer.sqlite`. Sie kann als SQLite-Verbindung in der Dev-Instanz geöffnet werden: Schema `main`, Tabelle `IFC_SENDEN_POS`, Filter `REF_KOPF = 8292`. Ein anderer Ausgabepfad kann als erstes Argument angegeben werden. Vorhandene Dateien werden nicht überschrieben.

Das SQL-Skript wird unverändert über das temporär angehängte Schema `EUROTIME` ausgeführt. In der fertigen SQLite-Datei liegt die Tabelle im Schema `main`. Der Regressionstest liest diese Daten aus einer echten SQLite-Datenbank, lädt die Zeilen in umgekehrter Reihenfolge und führt das gepackte Extension-Command aus. Er prüft das vollständige Dokument, NULL-Werte, die als String erhaltene Bestellnummer und einen Filter ohne Treffer.

### Extension bauen und prüfen

```sh
bun run extension dev extention/table-json-viewer
bun run extension pack extention/table-json-viewer extention/table-json-viewer/leon-achteresch.table-json-viewer-0.1.0.l8db-extension
bun test tests/table-json-viewer.test.ts tests/table-snapshot.test.ts
```

Das Paket ist lokal installierbar und für einen Community-Katalog vorbereitet. Eine Veröffentlichung im Community-Market ist ein eigener Schritt.

## Ergänzte Host-Schnittstellen

`contributes.menus[].location = "table/toolbar"` übergibt einen `TableSnapshot` als Command-Payload. Der Host prüft `database:read` vor dem Abruf und vor der Übergabe. Der Snapshot enthält Verbindung-ID, Datenbankname, Schema, Tabelle, aktiven Filter, Spaltennamen und alle passenden Zeilen, ohne Verbindungs-URL oder Zugangsdaten.

`api.panels.openJson(panelId, { text, filename?, description? })` öffnet ein im Manifest deklariertes Panel mit gültigem JSON im nativen, schreibgeschützten Viewer. `filename` ist der Dateiname ohne `.json`. Nach einem Tabellen-Command navigiert der Host zum geöffneten Panel. Bestehende HTML-Panels bleiben verfügbar.
