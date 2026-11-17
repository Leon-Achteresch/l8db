import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CsvFileCheck } from "@/features/import/csv-file-check";
import { useCsvFileCheck } from "@/features/import/csv-import-panel/use-csv-file-check";
import { csvFileCheckRequest } from "@/lib/csv-file-check";
import { parseCsv } from "@/lib/csv-import";
import { readCsvPreview } from "@/lib/db/columns";

const targets = ["id", "name"].map((name) => ({
  name,
  data_type: "text",
  is_nullable: false,
  has_default: false,
  is_identity: false,
  is_generated: false,
}));
const mappings = targets.map((target, csvIndex) => ({ csvIndex, target: target.name }));

export function CsvCheckDevelopment({ directory }: { directory: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useMemo(
    () =>
      path
        ? csvFileCheckRequest(
            {
              path,
              format: "csv",
              delimiter: ",",
              quote: '"',
              has_header: true,
              empty_as_null: true,
              indices: [0, 1],
            },
            2,
            mappings,
            targets,
          )
        : null,
    [path],
  );
  const check = useCsvFileCheck(request, "isolated-development");
  const pick = async () => {
    const selected = await open({
      defaultPath: `${directory}/samples/clean.csv`,
      multiple: false,
      directory: false,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (typeof selected !== "string") return;
    check.invalidate();
    setPath(null);
    setPreview("");
    setError(null);
    try {
      const loaded = await readCsvPreview(selected);
      const parsed = parseCsv(loaded.text, { delimiter: ",", hasHeader: true });
      setPreview(
        parsed.rows
          .slice(0, 5)
          .map((row) => row.join(" · "))
          .join("\n"),
      );
      setPath(selected);
    } catch (failure) {
      setError(String(failure));
    }
  };
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 bg-muted/40 px-4 py-3">
        <h1 className="text-sm font-semibold">CSV-Check · isolierte Entwicklung</h1>
        <Button onClick={() => void pick()}>CSV wählen</Button>
        <Button disabled title="Kein schreibbares Ziel registriert">
          Importieren gesperrt
        </Button>
      </header>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Flüchtiges Profil · synthetisches Ziel: id, name (Text, NOT NULL) · keine Verbindung,
        Secrets oder Hintergrunddienste.
      </p>
      <p className="break-all px-4 py-2 font-mono text-xs">{path ?? `${directory}/samples`}</p>
      {error && (
        <p role="alert" className="px-4 py-2 text-destructive">
          {error}
        </p>
      )}
      <CsvFileCheck check={check} importing={false} onPickFile={() => void pick()} />
      <pre className="overflow-auto px-4 py-3 text-xs">{preview}</pre>
    </main>
  );
}
