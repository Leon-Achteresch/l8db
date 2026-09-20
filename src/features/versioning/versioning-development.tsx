import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompareSidePicker } from "@/features/compare/compare-side-picker";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import { listCompareObjects } from "@/lib/compare-definition";
import { EMPTY_COMPARE_SIDE, supportedCompareObjectTypes } from "@/lib/compare-types";
import { useConnectionsStore } from "@/lib/connections";
import { versioningRepository } from "@/lib/db";
import { captureObject } from "@/lib/versioning/capture";
import { PROJECT_PATH } from "@/lib/versioning/model";
import { encode, readFile, saveFile } from "@/lib/versioning/repository";
import { newManagedObject, sourceFiles } from "@/lib/versioning/sources";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningDevelopment({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, projectText, status, run, refresh } = workspace;
  const connections = useConnectionsStore((state) => state.connections);
  const [side, setSide] = useState(EMPTY_COMPARE_SIDE);
  const [path, setPath] = useState("");
  const [original, setOriginal] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [base, setBase] = useState("");
  const [incoming, setIncoming] = useState("");
  useEffect(() => {
    workspace.setDirty(Boolean(path) && draft !== (saved ?? ""));
  }, [draft, saved, path, workspace.setDirty]);
  const load = async (file: string) => {
    if (path && draft !== (saved ?? ""))
      throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    const diff = await versioningRepository<{ original: string; modified: string }>({
      action: "diff",
      repo,
      path: file,
    });
    const current = await readFile(repo, file);
    if (diff.modified !== (current ?? ""))
      throw new Error("Datei wurde während des Lesens geändert. Bitte erneut öffnen.");
    setPath(file);
    setOriginal(diff.original);
    setDraft(diff.modified);
    setSaved(current);
  };
  const capture = async () => {
    if (path && draft !== (saved ?? ""))
      throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    const connection = connections.find((item) => item.id === side.connectionId);
    if (
      !project ||
      !connection ||
      connection.kind !== project.kind ||
      !side.schema ||
      !side.objectName
    )
      throw new Error("Ein passendes Datenbankobjekt auswählen.");
    const existing = project.objects.find(
      (object) =>
        object.selection.schema === side.schema &&
        object.selection.objectName === side.objectName &&
        object.selection.objectType === side.objectType,
    );
    const object = existing ?? newManagedObject(side);
    const snapshot = await captureObject(connection, side.database, object);
    for (const [file, source] of Object.entries(sourceFiles(snapshot))) {
      const previous = await readFile(repo, file);
      await saveFile(repo, file, source, previous);
    }
    if (!existing)
      await saveFile(
        repo,
        PROJECT_PATH,
        encode({ ...project, objects: [...project.objects, object] }),
        projectText,
      );
    await refresh();
    await load(object.path);
  };
  const captureSchema = async () => {
    if (path && draft !== (saved ?? ""))
      throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    const connection = connections.find((item) => item.id === side.connectionId);
    if (!project || !connection || connection.kind !== project.kind || !side.schema)
      throw new Error("Eine passende Verbindung und ein Schema auswählen.");
    const objects = [...project.objects];
    const captures = [];
    for (const objectType of supportedCompareObjectTypes(connection)) {
      const entries = await listCompareObjects(connection, { ...side, objectType });
      for (const entry of entries) {
        if (entry.name === "L8DB_VERSIONING_STATE") continue;
        if (captures.length >= 5000)
          throw new Error("Mehr als 5000 Objekte. Bitte einen kleineren Umfang wählen.");
        const selection = { ...side, objectType, objectName: entry.name, objectOid: entry.oid };
        let object = objects.find(
          (item) =>
            item.selection.schema === side.schema &&
            item.selection.objectType === objectType &&
            item.selection.objectName === entry.name,
        );
        if (!object) {
          object = newManagedObject(selection);
          objects.push(object);
        }
        workspace.setMessage(`Schema lesen: ${entry.name}`);
        captures.push(await captureObject(connection, side.database, object));
      }
    }
    if (!captures.length) throw new Error("Keine lesbaren Objekte im Schema gefunden.");
    for (const snapshot of captures) {
      for (const [file, source] of Object.entries(sourceFiles(snapshot)))
        await saveFile(repo, file, source, await readFile(repo, file));
    }
    await saveFile(repo, PROJECT_PATH, encode({ ...project, objects }), projectText);
    await refresh();
  };
  const merge = async () => {
    if (!base.trim() || !incoming.trim()) throw new Error("Basis- und Produkt-Commit angeben.");
    const [ancestor, product] = await Promise.all([
      readFile(repo, path, base),
      readFile(repo, path, incoming),
    ]);
    if (ancestor === null || product === null) throw new Error("Objekt fehlt in einer Revision.");
    const result = await versioningRepository<{ content: string; conflicts: boolean }>({
      action: "merge",
      repo,
      content: draft,
      base: ancestor,
      incoming: product,
    });
    setOriginal(product);
    setDraft(result.content);
    workspace.setMessage(
      result.conflicts
        ? "Merge-Konflikte im Entwurf auflösen. Es wurde nichts gespeichert."
        : "Text-Merge erstellt. Fachliche Prüfung und Tests bleiben erforderlich.",
    );
  };
  if (!project || !status) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-3">
          <CompareSidePicker
            title="Objekt aus Datenbank übernehmen"
            value={side}
            onChange={setSide}
          />
          <Button
            onClick={() => void run(capture, "Objektdefinition in den Arbeitsbaum übernommen")}
          >
            Definition übernehmen
          </Button>
          <Button
            variant="outline"
            onClick={() => void run(captureSchema, "Unterstützte Schema-Objekte aufgenommen")}
          >
            Schema aufnehmen
          </Button>
          <p className="text-xs text-muted-foreground">
            Verwaltet werden die ausdrücklich aufgenommenen Objekte. Tabellen enthalten
            Vergleichsmetadaten; Datenzeilen werden nicht exportiert.
          </p>
        </div>
        <div className="rounded border p-3">
          <h2 className="mb-2 text-sm font-semibold">Projektdateien</h2>
          <div className="max-h-64 overflow-auto">
            {status.files.map((file) => (
              <div key={file} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  aria-label={`Commit: ${file}`}
                  checked={selected.includes(file)}
                  onChange={(event) =>
                    setSelected((items) =>
                      event.target.checked
                        ? [...items, file]
                        : items.filter((item) => item !== file),
                    )
                  }
                />
                <button
                  type="button"
                  className="truncate text-left font-mono text-xs hover:underline"
                  onClick={() => void run(() => load(file))}
                >
                  {project.objects.find(
                    (object) => object.path === file || object.bodyPath === file,
                  )?.selection.objectName ?? file}
                  {file.endsWith(".pks")
                    ? " · Specification"
                    : file.endsWith(".pkb")
                      ? " · Body"
                      : ""}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              aria-label="Commit-Nachricht"
              placeholder="Commit-Nachricht"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              disabled={!selected.length || !message.trim()}
              onClick={() =>
                void run(async () => {
                  await workspace.git("commit", message, selected);
                  setSelected([]);
                  if (path) await load(path);
                }, "Ausgewählte Dateien committet")
              }
            >
              Commit ({selected.length})
            </Button>
          </div>
          <details className="mt-3 text-xs">
            <summary>Git-Status und Historie</summary>
            <pre className="mt-2 whitespace-pre-wrap">
              {status.changes.replaceAll("\0", "\n") || "Arbeitsbaum sauber"}
              {"\n\n"}
              {status.history}
            </pre>
          </details>
        </div>
      </div>
      {path && (
        <div className="flex flex-col gap-2 rounded border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
            <Button
              variant="outline"
              disabled={draft === saved}
              onClick={() => setDraft(saved ?? "")}
            >
              Entwurf verwerfen
            </Button>
            <Button
              disabled={draft === saved}
              onClick={() =>
                void run(async () => {
                  await saveFile(repo, path, draft, saved);
                  setSaved(draft);
                  workspace.setDirty(false);
                  await refresh();
                }, "Entwurf gespeichert")
              }
            >
              Entwurf speichern
            </Button>
          </div>
          <div className="h-[420px]">
            <DefinitionDiffEditor
              original={original}
              modified={draft}
              onlyDifferences={false}
              onModifiedChange={setDraft}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Gemeinsamer Basis-Commit"
              placeholder="Gemeinsamer Basis-Commit"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              className="flex-1"
            />
            <Input
              aria-label="Neuer Produkt-Commit"
              placeholder="Neuer Produkt-Commit"
              value={incoming}
              onChange={(event) => setIncoming(event.target.value)}
              className="flex-1"
            />
            <Button variant="outline" onClick={() => void run(merge)}>
              Drei-Wege-Merge
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
