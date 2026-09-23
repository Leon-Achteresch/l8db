import {
  ArrowLeftIcon,
  FileDiffIcon,
  PlusIcon,
  ShieldCheckIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import { cn } from "@/lib/utils";
import {
  checksum,
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
import { VersioningPopover } from "./versioning-popover";
import { VersioningSafetyEditor } from "./versioning-safety-editor";
import { VersioningSelect } from "./versioning-select";

export function VersioningReleases({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, releases, run, refresh } = workspace;
  const [creating, setCreating] = useState(false);
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
    if (!parent && releases.some((release) => releaseTrack(release) === track))
      throw new Error(
        "Für diese Release-Linie existiert bereits eine Baseline. Einen Vorgänger auswählen.",
      );
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
    await refresh();
    setSelected(release);
    setCreating(false);
    setId("");
    setSql("");
    setTrack("main");
    setSafety(defaultSafety());
    workspace.setDirty(false);
  };
  const chosen = selected ?? releases.at(-1);
  const changes = changedFiles(workspace.status?.changes ?? "");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="text-xs font-semibold">{creating ? "Release vorbereiten" : "Releases"}</h2>
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
            onClick={() => {
              if (!releases.length) setId(`baseline-${new Date().toISOString().slice(0, 10)}`);
              setParent(
                releases.filter((release) => releaseTrack(release) === "main").at(-1)?.id ?? "",
              );
              setCreating(true);
            }}
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
                onChange={setParent}
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
          <div className="flex items-center justify-between">
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
                    generate,
                    "Migrationsentwurf erzeugt. Vor Freigabe in einer Testdatenbank prüfen.",
                  )
                }
              >
                <FileDiffIcon className="size-3.5" />
                SQL entwerfen
              </Button>
              <VersioningPopover
                icon={ShieldCheckIcon}
                label="Betriebsplan und Prüfungen"
                className="w-[440px] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto"
                disabled={workspace.busy}
              >
                <VersioningSafetyEditor value={safety} onChange={setSafety} />
              </VersioningPopover>
            </div>
          </div>
          <textarea
            id="vcs-migration-sql"
            aria-label="Migrations-SQL"
            className="min-h-64 w-full resize-y rounded-lg bg-muted/35 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            placeholder={
              parent
                ? "Geprüfte Migration für diesen Release …"
                : "Eine Baseline erfasst den bestehenden Stand ohne Migration."
            }
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Der Release wird zunächst als Datei angelegt. Nach dem Commit kann er geprüft und
            ausgerollt werden.
          </p>
          <Button
            size="sm"
            disabled={!id.trim()}
            onClick={() =>
              void run(create, "Release-Datei erstellt. Unter Änderungen auswählen und committen.")
            }
          >
            Release-Datei anlegen
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
              <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
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
