export type DataExportFormat = "parquet" | "xml" | "html";

export const DATA_EXPORT_FORMATS: {
  value: DataExportFormat;
  label: string;
  extension: string;
  description: string;
}[] = [
  {
    value: "parquet",
    label: "Parquet",
    extension: "parquet",
    description:
      "Spaltenorientiert mit Typen: Ganzzahlen, Gleitkommazahlen, Boolean, Datum und Zeitstempel; alles andere als Text.",
  },
  {
    value: "xml",
    label: "XML",
    extension: "xml",
    description: 'Elemente <rows>/<row>/<column name=…>; NULL wird als null="true" markiert.',
  },
  {
    value: "html",
    label: "HTML",
    extension: "html",
    description: "Eigenständige HTML-Datei mit einer Tabelle und einfachen Inline-Styles.",
  },
];

export function dataExportFormatInfo(format: DataExportFormat) {
  return DATA_EXPORT_FORMATS.find((entry) => entry.value === format) ?? DATA_EXPORT_FORMATS[0];
}
