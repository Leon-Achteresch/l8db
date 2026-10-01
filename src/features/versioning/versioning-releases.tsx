import { ArrowLeftIcon, FileDiffIcon, PlusIcon, TagIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { versioningRepository } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { generateMigration, type MigrationDraft } from "@/lib/versioning/migrations";
import {
  checksum,
  deployKind,
  PROJECT_PATH,
  parseRelease,
  releasePath,
  releaseTrack,
  validateMigration,
  validateReleaseGraph,
} from "@/lib/versioning/model";
import { encode, saveFile } from "@/lib/versioning/repository";
import { defaultSafety } from "@/lib/versioning/safety";
import { workingSnapshot } from "@/lib/versioning/sources";
import { changedFiles } from "@/lib/versioning/status";
import type { DatabaseRelease, ObjectSnapshot } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningSafetyEditor } from "./versioning-safety-editor";
import { VersioningSelect } from "./versioning-select";

export function VersioningReleases({
  workspace,
  onRollout,
}: {
  workspace: VersioningWorkspace;
  onRollout: (id: string) => void;
}) {
  const { repo, project, releases, run, refresh } = workspace;
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.releases.generate");
  const [creating, setCreating] = useState(false);
  const [migration, setMigration] = useState<MigrationDraft | null>(null);
  const [allowDrops, setAllowDrops] = useState(false);
  const [manualReviewed, setManualReviewed] = useState(false);
  const [generatedFor, setGeneratedFor] = useState("");
  const [id, setId] = useState("");
  const [parent, setParent] = useState("");
  const [sql, setSql] = useState("");
  const [track, setTrack] = useState("main");
  const [safety, setSafety] = useState(defaultSafety);
  const [selected, setSelected] = useState<DatabaseRelease | null>(null);
  useEffect(() => {
    workspace.setDirty(
      Boolean(
        id.trim() ||
          sql.trim() ||
          track !== "main" ||
          JSON.stringify(safety) !== JSON.stringify(defaultSafety()),
      ),
    );
  }, [id, sql, track, safety, workspace.setDirty]);
  const snapshots = async (): Promise<ObjectSnapshot[]> => {
    if (!project?.objects.length) throw new Error("Zuerst mindestens ein Objekt aufnehmen.");
    const result: ObjectSnapshot[] = [];
    for (const object of project.objects) {
      result.push(await workingSnapshot(repo, object));
    }
    return result;
  };
  const generate = async (predecessor = parent) => {
    if (!project) return;
    const before = releases.find((release) => release.id === predecessor);
    if (!before) throw new Error("Für einen Migrationsentwurf einen Vorgänger auswählen.");
    const current = await snapshots();
    const result = generateMigration(project.kind, before, current, allowDrops);
    setMigration(result);
    setManualReviewed(false);
    setGeneratedFor(JSON.stringify(current.map((item) => [item.object.id, item.checksum])));
    setSql(result.sql);
    if (!result.changes.length)
      workspace.setMessage(
        "Keine Schemaänderungen. Datenmigrationen können als SQL ergänzt werden.",
      );
  };
  const prepare = async () => {
    const latest = releases.filter((release) => releaseTrack(release) === "main").at(-1);
    setParent(latest?.id ?? "");
    setId(latest ? "" : `baseline-${new Date().toISOString().slice(0, 10)}`);
    setCreating(true);
    if (latest) await generate(latest.id);
  };
  const create = async (commit: boolean) => {
    if (!project) return;
    const path = releasePath(id);
    if (releases.some((release) => release.id === id))
      throw new Error("Release-ID existiert bereits. Einen neuen Release anlegen.");
    if (!parent && releases.some((release) => releaseTrack(release) === track))
      throw new Error(
        "Für diese Release-Linie existiert bereits eine Baseline. Einen Vorgänger auswählen.",
      );
    const objects = await snapshots();
    if (
      generatedFor &&
      generatedFor !== JSON.stringify(objects.map((item) => [item.object.id, item.checksum]))
    )
      throw new Error(
        "Definitionen wurden seit der SQL-Erzeugung geändert. Migration erneut erzeugen und prüfen.",
      );
    if (migration?.issues.length && !manualReviewed)
      throw new Error("Offene Migrationspunkte im SQL ergänzen und ihre Prüfung bestätigen.");
    if (parent && !sql.trim())
      throw new Error("Ein Update-Release benötigt eine geprüfte Migration.");
    if (!parent && sql.trim())
      throw new Error(
        "Eine Baseline erfasst den bestehenden Stand. SQL erst im nächsten Release hinzufügen.",
      );
    if (sql.trim()) validateMigration(sql, deployKind(project.kind));
    const release: DatabaseRelease = {
      format: 1,
      id,
      projectId: project.id,
      kind: deployKind(project.kind),
      parent: parent || null,
      createdAt: new Date().toISOString(),
      objects,
      migrations: sql.trim()
        ? [{ id: `${id}-migration`, title: `Update auf ${id}`, sql, checksum: await checksum(sql) }]
        : [],
      track,
      safety: {
        ...safety,
        preconditions: await Promise.all(
          safety.preconditions.map(async (check) => ({
            ...check,
            checksum: await checksum(check.sql),
          })),
        ),
        postconditions: await Promise.all(
          safety.postconditions.map(async (check) => ({
            ...check,
            checksum: await checksum(check.sql),
          })),
        ),
      },
    };
    await parseRelease(encode(release), project);
    validateReleaseGraph([...releases, release]);
    await saveFile(repo, path, encode(release), null);
    workspace.setDirty(false);
    setSelected(release);
    setCreating(false);
    setId("");
    setSql("");
    setTrack("main");
    setSafety(defaultSafety());
    setMigration(null);
    setGeneratedFor("");
    setManualReviewed(false);
    setAllowDrops(false);
    workspace.setDirty(false);
    try {
      if (commit) {
        const paths = [
          ...new Set(
            [
              PROJECT_PATH,
              path,
              ...objects.flatMap((item) => [
                item.object.path,
                ...(item.object.bodyPath ? [item.object.bodyPath] : []),
              ]),
              ...changedFiles(workspace.status?.changes ?? "").keys(),
            ].filter(
              (file) =>
                file === PROJECT_PATH || file === path || file.startsWith("database/objects/"),
            ),
          ),
        ];
        await versioningRepository({
          action: "commit",
          repo,
          name: `Database release ${id}`,
          paths,
        });
      }
    } finally {
      await refresh();
    }
  };
  const chosen = selected ?? releases.at(-1);
  const changes = changedFiles(workspace.status?.changes ?? "");
  return (
    <div ref={feature.ref} className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {creating ? "Migration & Release vorbereiten" : "Releases"}
            {feature.isNew && <NewBadge />}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {creating
              ? "Definitionen und Migrationen gemeinsam fixieren."
              : `${releases.length} Versionen im Repository`}
          </p>
        </div>
        {creating ? (
          <>
            <VersioningIconButton
              icon={Trash2Icon}
              label="Release-Entwurf verwerfen"
              onClick={() => {
                setId("");
                setSql("");
                setTrack("main");
                setSafety(defaultSafety());
                workspace.setDirty(false);
                setMigration(null);
                setGeneratedFor("");
                setAllowDrops(false);
                setManualReviewed(false);
                setCreating(false);
              }}
            />
            <VersioningIconButton
              icon={ArrowLeftIcon}
              label="Zur Releaseübersicht"
              onClick={() => {
                if (workspace.dirty)
                  void run(async () => {
                    throw new Error("Release-Entwurf zuerst speichern oder verwerfen.");
                  });
                else setCreating(false);
              }}
            />
          </>
        ) : (
          <VersioningIconButton
            icon={PlusIcon}
            label="Release vorbereiten"
            onClick={() => void run(prepare)}
          />
        )}
      </div>
      {creating ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="vcs-release-id" className="space-y-1.5 text-xs font-medium">
              Release-ID
              <Input
                id="vcs-release-id"
                aria-label="Release-ID"
                placeholder="z. B. 4.2.0"
                value={id}
                onChange={(event) => setId(event.target.value)}
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium">Vorgänger</span>
              <VersioningSelect
                label="Vorgänger-Release"
                value={parent}
                onChange={(value) => {
                  setParent(value);
                  setMigration(null);
                  setGeneratedFor("");
                  setManualReviewed(false);
                }}
                options={[
                  { value: "", label: "Baseline" },
                  ...releases.map((release) => ({ value: release.id, label: release.id })),
                ]}
              />
            </div>
          </div>
          <label htmlFor="vcs-release-track" className="space-y-1.5 text-xs font-medium">
            Release-Linie
            <Input
              id="vcs-release-track"
              aria-label="Release-Linie"
              value={track}
              onChange={(event) => setTrack(event.target.value)}
              placeholder="main oder Kundenvariante"
            />
          </label>
          <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={allowDrops}
              onChange={(event) => setAllowDrops(event.target.checked)}
            />
            Entfernungen beim nächsten Erzeugen einschließen. DROP-Anweisungen können Daten löschen.
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="vcs-migration-sql" className="text-xs font-medium">
              Migrations-SQL
            </label>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={!parent}
                onClick={() =>
                  void run(
                    () => generate(),
                    "Migrationsentwurf erzeugt. Vor Freigabe in einer Testdatenbank prüfen.",
                  )
                }
              >
                <FileDiffIcon className="size-3.5" />
                Migration automatisch erzeugen
              </Button>
            </div>
          </div>
          {migration && (
            <div className="space-y-2 rounded-lg bg-muted/25 p-3">
              <p className="text-xs font-medium">
                {migration.changes.filter((change) => change.generated).length} von{" "}
                {migration.changes.length} Änderungen automatisch erzeugt
              </p>
              {migration.changes.map((change) => (
                <p key={change.label} className="text-[11px] text-muted-foreground">
                  {change.status === "added"
                    ? "Neu"
                    : change.status === "removed"
                      ? "Entfernt"
                      : "Geändert"}{" "}
                  · {change.label} · {change.generated ? "SQL erzeugt" : "Manuell ergänzen"}
                </p>
              ))}
              {migration.issues.map((issue) => (
                <p
                  key={issue.label}
                  className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
                >
                  {issue.label}: {issue.reason}
                </p>
              ))}
              {migration.issues.length > 0 && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={manualReviewed}
                    onChange={(event) => setManualReviewed(event.target.checked)}
                  />
                  Alle offenen Punkte im SQL ergänzt und geprüft
                </label>
              )}
            </div>
          )}
          <details className="rounded-lg bg-muted/20 p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Betriebsplan und Datenprüfungen
            </summary>
            <div className="mt-4">
              <VersioningSafetyEditor value={safety} onChange={setSafety} />
            </div>
          </details>
          <Textarea
            id="vcs-migration-sql"
            aria-label="Migrations-SQL"
            className="min-h-64 resize-y font-mono text-xs leading-relaxed"
            value={sql}
            onChange={(event) => {
              setSql(event.target.value);
              setManualReviewed(false);
            }}
            placeholder={
              parent
                ? "Geprüfte Migration für diesen Release …"
                : "Eine Baseline erfasst den bestehenden Stand ohne Migration."
            }
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Speichern und committen fixiert den Release mit seinen Definitionen. Danach direkt zu
            den Kundenzielen wechseln und den Rollout prüfen.
          </p>
          <Button
            size="sm"
            disabled={!id.trim() || Boolean(migration?.issues.length && !manualReviewed)}
            onClick={() =>
              void run(
                () => create(true),
                "Release und Definitionen gespeichert und committet. Rollout unter Kunden planen.",
              )
            }
          >
            Release speichern und committen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!id.trim() || Boolean(migration?.issues.length && !manualReviewed)}
            onClick={() =>
              void run(
                () => create(false),
                "Release-Entwurf gespeichert. Vor dem Rollout committen.",
              )
            }
          >
            Nur als Entwurf speichern
          </Button>
        </div>
      ) : (
        <>
          {!releases.length && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <TagIcon className="size-7 text-muted-foreground/40" strokeWidth={1.4} />
              <p className="text-xs font-medium">Der erste Stand beginnt hier</p>
              <p className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
                Nimm deine Definitionen auf und erstelle daraus eine Baseline.
              </p>
              <Button size="sm" variant="ghost" onClick={() => void run(prepare)}>
                Baseline vorbereiten
              </Button>
            </div>
          )}
          <div className="max-h-64 space-y-1 overflow-auto">
            {[...releases].reverse().map((release) => (
              <button
                key={release.id}
                type="button"
                onClick={() => setSelected(release)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/40",
                  chosen?.id === release.id && "bg-muted/50",
                )}
              >
                <TagIcon className="size-4 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium">{release.id}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {releaseTrack(release)} · {release.objects.length} Objekte ·{" "}
                    {release.parent ? `von ${release.parent}` : "Baseline"}
                  </span>
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {changes.has(`database/releases/${release.id}.json`)
                    ? "Entwurf"
                    : new Date(release.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
          {chosen && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">{chosen.id}</h3>
                <span className="text-[11px] text-muted-foreground">
                  {chosen.migrations.length} Migrationen
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {chosen.objects
                  .map(
                    (entry) =>
                      `${entry.object.selection.schema}.${entry.object.selection.objectName}`,
                  )
                  .join(" · ")}
              </p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                {chosen.migrations.map((entry) => entry.sql).join("\n\n") ||
                  "Baseline · bestehender Ausgangsstand ohne Migration"}
              </pre>
              {changes.has(releasePath(chosen.id)) || !workspace.status?.head ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(async () => {
                      await versioningRepository({
                        action: "commit",
                        repo,
                        name: `Database release ${chosen.id}`,
                        paths: [
                          PROJECT_PATH,
                          releasePath(chosen.id),
                          ...chosen.objects.flatMap((item) => [
                            item.object.path,
                            ...(item.object.bodyPath ? [item.object.bodyPath] : []),
                          ]),
                          ...changedFiles(workspace.status?.changes ?? "").keys(),
                        ].filter(
                          (file) =>
                            file === PROJECT_PATH ||
                            file === releasePath(chosen.id) ||
                            file.startsWith("database/objects/"),
                        ),
                      });
                      await refresh();
                    }, "Release committet")
                  }
                >
                  Release committen
                </Button>
              ) : (
                <Button size="sm" onClick={() => onRollout(chosen.id)}>
                  Rollout für {chosen.id} planen
                </Button>
              )}
              {chosen.safety && (
                <details className="text-xs">
                  <summary className="cursor-pointer">Betriebsplan · {chosen.safety.phase}</summary>
                  <div className="mt-3 space-y-2">
                    <p>{chosen.safety.notes || "Noch keine Betriebsnotizen"}</p>
                    <p>
                      {chosen.safety.compatibility === "maintenance"
                        ? "Wartungsfenster erforderlich"
                        : "Mit laufender Anwendung"}
                    </p>
                    <p>
                      Vorprüfung:{" "}
                      {chosen.safety.preconditions.map((check) => check.title).join(", ") ||
                        "Keine"}
                    </p>
                    <p>
                      Nachprüfung:{" "}
                      {chosen.safety.postconditions.map((check) => check.title).join(", ") ||
                        "Keine"}
                    </p>
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
