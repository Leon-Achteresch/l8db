import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import { checksum, releasePath, validateMigration } from "@/lib/versioning/model";
import { encode, saveFile } from "@/lib/versioning/repository";
import { workingSnapshot } from "@/lib/versioning/sources";
import type { DatabaseRelease, ObjectSnapshot } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningReleases({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, releases, run, refresh } = workspace;
  const [id, setId] = useState("");
  const [parent, setParent] = useState("");
  const [sql, setSql] = useState("");
  const [selected, setSelected] = useState<DatabaseRelease | null>(null);
  useEffect(() => {
    workspace.setDirty(Boolean(id.trim() || sql.trim()));
  }, [id, sql, workspace.setDirty]);
  const snapshots = async (): Promise<ObjectSnapshot[]> => {
    if (!project?.objects.length) throw new Error("Zuerst mindestens ein Objekt aufnehmen.");
    const result: ObjectSnapshot[] = [];
    for (const object of project.objects) {
      result.push(await workingSnapshot(repo, object));
    }
    return result;
  };
  const generate = async () => {
    if (!project) return;
    const before = releases.find((release) => release.id === parent);
    if (!before) throw new Error("Für einen Migrationsentwurf einen Vorgänger auswählen.");
    const current = await snapshots();
    if (before.objects.some((item) => !current.some((next) => next.object.id === item.object.id)))
      throw new Error("Objektentfernungen benötigen eine ausdrücklich geschriebene Migration.");
    const statements: string[] = [];
    for (const item of current) {
      const old = before.objects.find((previous) => previous.object.id === item.object.id);
      if (!old)
        throw new Error("Neue Objekte benötigen eine ausdrücklich geschriebene CREATE-Migration.");
      if (old.checksum === item.checksum) continue;
      statements.push(
        ...buildCompareApplyPlan(
          project.kind,
          { ...item.object.selection, connectionId: null, database: null },
          old.definition,
          item.definition,
        ),
      );
    }
    if (!statements.length) throw new Error("Keine Änderungen an den verwalteten Definitionen.");
    setSql(statements.join(project.kind === "oracle" ? "\n/\n" : "\n\n"));
  };
  const create = async () => {
    if (!project) return;
    const path = releasePath(id);
    if (releases.some((release) => release.id === id))
      throw new Error("Release-ID existiert bereits. Einen neuen Release anlegen.");
    if (releases.length && !parent)
      throw new Error("Für weitere Releases einen Vorgänger auswählen.");
    const objects = await snapshots();
    if (parent && !sql.trim())
      throw new Error("Ein Update-Release benötigt eine geprüfte Migration.");
    if (!parent && sql.trim())
      throw new Error(
        "Eine Baseline erfasst den bestehenden Stand. SQL erst im nächsten Release hinzufügen.",
      );
    if (sql.trim()) validateMigration(sql, project.kind);
    const release: DatabaseRelease = {
      format: 1,
      id,
      projectId: project.id,
      kind: project.kind,
      parent: parent || null,
      createdAt: new Date().toISOString(),
      objects,
      migrations: sql.trim()
        ? [{ id: `${id}-migration`, title: `Update auf ${id}`, sql, checksum: await checksum(sql) }]
        : [],
    };
    await saveFile(repo, path, encode(release), null);
    workspace.setDirty(false);
    await refresh();
    setSelected(release);
    setId("");
    setSql("");
    workspace.setDirty(false);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Releases</h2>
        {releases.length === 0 && (
          <p className="text-sm text-muted-foreground">Noch keine Baseline vorhanden.</p>
        )}
        {releases.map((release) => (
          <Button
            key={release.id}
            variant="outline"
            className="justify-start"
            onClick={() => setSelected(release)}
          >
            {release.id} · {release.objects.length} Objekte
          </Button>
        ))}
        {selected && (
          <div className="rounded border p-3 text-xs">
            <p>Vorgänger: {selected.parent ?? "Baseline"}</p>
            <p>Migrationen: {selected.migrations.length}</p>
            <p>Erstellt: {new Date(selected.createdAt).toLocaleString()}</p>
            <details className="mt-2">
              <summary>SQL und verwaltete Objekte</summary>
              <ul className="my-2">
                {selected.objects.map((entry) => (
                  <li key={entry.object.id}>
                    {entry.object.selection.schema}.{entry.object.selection.objectName}
                  </li>
                ))}
              </ul>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap">
                {selected.migrations.map((entry) => entry.sql).join("\n\n") ||
                  "Keine Migration: bestehender Ausgangsstand"}
              </pre>
            </details>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-semibold">Release vorbereiten</h2>
        <p className="text-sm text-muted-foreground">
          Der Release fixiert Definitionen und Migrationen. Erst nach dem Commit kann er einer
          Datenbank zugeordnet oder ausgerollt werden.
        </p>
        <Input
          aria-label="Release-ID"
          placeholder="z. B. 4.2.0"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        <label className="text-sm">
          Vorgänger
          <select
            aria-label="Vorgänger-Release"
            className="mt-1 block w-full rounded border bg-background p-2"
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          >
            <option value="">Baseline ohne Vorgänger</option>
            {releases.map((release) => (
              <option key={release.id}>{release.id}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!parent}
          onClick={() =>
            void run(
              generate,
              "Migrationsentwurf erzeugt. Vor Freigabe in einer Testdatenbank ausführen.",
            )
          }
        >
          Migration aus Objektänderungen entwerfen
        </Button>
        <label className="text-sm">
          Migrations-SQL
          <textarea
            aria-label="Migrations-SQL"
            className="mt-1 min-h-72 w-full rounded border bg-background p-3 font-mono text-xs"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            placeholder="SQL wird beim Anlegen des Releases nicht ausgeführt."
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            setId("");
            setSql("");
          }}
        >
          Release-Entwurf verwerfen
        </Button>
        <Button
          onClick={() =>
            void run(create, "Release-Datei erstellt. Unter Entwicklung auswählen und committen.")
          }
        >
          Release-Datei anlegen
        </Button>
      </div>
    </div>
  );
}
