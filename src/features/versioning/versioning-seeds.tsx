import { DatabaseIcon, SaveIcon, SproutIcon, WandSparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatagenColumnRow } from "@/features/datagen/datagen-column-row";
import { useConnectionsStore } from "@/lib/connections";
import { type DatagenPlan, datagenPlan, datagenSeedScript, versioningRunSeed } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum, deployKind } from "@/lib/versioning/model";
import { readFile, saveFile } from "@/lib/versioning/repository";
import { SEED_PATH, seedBranchAllowed, seedStatementCount } from "@/lib/versioning/seeds";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

export function VersioningSeeds({ workspace }: { workspace: VersioningWorkspace }) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.seeds");
  const connections = useConnectionsStore((state) => state.connections);
  const [sql, setSql] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [table, setTable] = useState("");
  const [rows, setRows] = useState(20);
  const [seed, setSeed] = useState(42);
  const [plan, setPlan] = useState<DatagenPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const planScope = useRef("");
  const { project, status, repo, branchTargetId, setBranchTargetId, run, refresh } = workspace;
  const allowed = seedBranchAllowed(status?.branch);
  const targets = workspace.targets?.targets.filter((target) => !target.production) ?? [];
  const target = targets.find((target) => target.id === branchTargetId);
  const connection = connections.find((connection) => connection.id === target?.connectionId);
  useEffect(() => {
    if (!status?.branch) return;
    let active = true;
    setLoaded(false);
    setLoadError("");
    readFile(repo, SEED_PATH)
      .then((text) => {
        if (active) {
          setSaved(text);
          setSql(text ?? "");
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (active) setLoadError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, status?.branch]);
  useEffect(() => {
    workspace.setDirty(loaded && sql !== (saved ?? ""));
  }, [loaded, sql, saved, workspace.setDirty]);
  useEffect(() => {
    const scope = `${branchTargetId}:${table}`;
    if (planScope.current !== scope) {
      planScope.current = scope;
      setPlan(null);
      setConfirmation("");
    }
  }, [branchTargetId, table]);
  if (!project || !status) return null;
  const tables = project.objects.filter((object) => object.selection.objectType === "table");
  const generate = async () => {
    if (!allowed || !target?.schema || !connection || !table)
      throw new Error("Development-Ziel und Tabelle auf einem Nebenbranch wählen.");
    if (!plan) {
      setPlan(
        await datagenPlan(
          connection.kind,
          effectiveConnectionString(connection),
          target.schema,
          table,
          target.database ?? undefined,
        ),
      );
      return;
    }
    const generated = await datagenSeedScript(
      connection.kind,
      effectiveConnectionString(connection),
      {
        schema: target.schema,
        table,
        rows,
        batchSize: 100,
        seed,
        locale: "de",
        transaction: true,
        columns: plan.columns,
        unique: plan.unique,
        source: null,
      },
      target.database ?? undefined,
    );
    setSql((current) => `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${generated}`);
    setConfirmation("");
  };
  const save = async () => {
    if (!allowed) throw new Error("Seeds sind auf dem Hauptbranch gesperrt.");
    seedStatementCount(sql, deployKind(project.kind));
    await saveFile(repo, SEED_PATH, sql, saved);
    setSaved(sql);
    workspace.setDirty(false);
    await refresh();
  };
  const execute = async () => {
    if (!target || !connection || !allowed || confirmation !== target.name || sql !== saved)
      throw new Error("Gespeicherten Seed und Development-Ziel bestätigen.");
    seedStatementCount(sql, deployKind(project.kind));
    const inserted = await versioningRunSeed({
      repo,
      branch: status.branch,
      targetId: target.id,
      checksum: await checksum(sql),
      connection: {
        kind: connection.kind,
        connectionString: effectiveConnectionString(connection),
        database: target.database,
        schema: target.schema,
        projectId: project.id,
        readOnly: connection.readOnly ?? false,
      },
    });
    setConfirmation("");
    workspace.setMessage(`${inserted} Seed-Zeilen in ${target.name} eingefügt`);
  };
  return (
    <section ref={feature.ref} className="space-y-5" aria-label="Development-Seeds">
      <div className="flex items-center gap-2">
        <SproutIcon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Seed-Daten</h2>
        {feature.isNew && <NewBadge />}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Reproduzierbare Beispieldaten als SQL im aktuellen Git-Branch. Erst Migrationen ausrollen,
        danach Seeds anwenden. Vorhandene Daten werden ergänzt.
      </p>
      {!allowed && (
        <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-xs">
          Seeds sind auf {status.branch ?? "Detached HEAD"} gesperrt. Unter Branches zu Development
          oder einem Feature-Branch wechseln.
        </p>
      )}
      <fieldset disabled={!allowed || workspace.busy || !loaded} className="space-y-4">
        <VersioningSelect
          label="Development-Ziel dieses Branches"
          value={branchTargetId}
          onChange={(id) => {
            if (workspace.dirty) {
              void run(async () => {
                throw new Error("Seed-Entwurf zuerst speichern oder verwerfen.");
              });
              return;
            }
            setBranchTargetId(id);
          }}
          placeholder="Development-Umgebung zuordnen"
          options={targets.map((target) => ({
            value: target.id,
            label: `${target.customer || target.name} · ${target.environment || "Development"} · ${target.database || "Datenbank"} / ${target.schema}`,
          }))}
        />
        {!targets.length && (
          <p className="text-[11px] text-muted-foreground">
            Unter Kunden & Umgebungen ein Ziel hinzufügen und die Produktionskennzeichnung
            deaktivieren.
          </p>
        )}
        {target && (
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <DatabaseIcon className="size-3.5" />
            {connection?.name ?? "Verbindung fehlt"} · {target.database} / {target.schema}
            {!target.release && " · Zuerst Baseline prüfen"}
          </p>
        )}
        <div className="rounded-xl bg-muted/25 p-3 space-y-3">
          <h3 className="text-xs font-semibold">Beispieldaten aus der Tabellenstruktur erzeugen</h3>
          <VersioningSelect
            label="Seed-Tabelle"
            value={table}
            onChange={setTable}
            placeholder="Tabelle wählen"
            options={tables.map((object) => ({
              value: object.selection.objectName ?? "",
              label: object.selection.objectName ?? "",
            }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="vcs-seed-rows" className="text-xs space-y-1.5">
              Zeilen
              <Input
                id="vcs-seed-rows"
                type="number"
                min={1}
                max={1000}
                value={rows}
                onChange={(event) => setRows(Number(event.target.value))}
              />
            </label>
            <label htmlFor="vcs-seed-number" className="text-xs space-y-1.5">
              Zufalls-Seed
              <Input
                id="vcs-seed-number"
                type="number"
                min={0}
                max={4294967295}
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
              />
            </label>
          </div>
          {plan && (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {plan.columns.map((column, index) => (
                  <DatagenColumnRow
                    key={column.name}
                    column={column}
                    onChange={(patch) =>
                      setPlan({
                        ...plan,
                        columns: plan.columns.map((entry, i) =>
                          i === index ? { ...entry, ...patch } : entry,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!target || !connection || !table || rows < 1 || rows > 1000}
            onClick={() => void run(generate)}
          >
            <WandSparklesIcon className="size-3.5" />
            {plan ? "Seed-SQL hinzufügen" : "Generatoren ermitteln"}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Typen, Pflichtfelder und vorhandene Fremdschlüssel werden berücksichtigt. Neue abhängige
            Tabellen in der richtigen Reihenfolge befüllen. Gleiche Konfiguration und Referenzdaten
            erzeugen mit demselben Zufalls-Seed dieselben Werte.
          </p>
        </div>
        <label htmlFor="vcs-seed-sql" className="block text-xs font-medium">
          Seed-SQL · <span className="font-mono text-muted-foreground">{SEED_PATH}</span>
        </label>
        <textarea
          id="vcs-seed-sql"
          aria-label="Seed-SQL"
          className="min-h-64 w-full rounded-lg bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={sql}
          onChange={(event) => {
            setSql(event.target.value);
            setConfirmation("");
          }}
          placeholder="INSERT INTO public.example (name) VALUES ('Beispiel');"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!sql.trim() || sql === saved}
            onClick={() => void run(save, "Seed-Datei gespeichert. Unter Änderungen committen.")}
          >
            <SaveIcon className="size-3.5" />
            Seed speichern
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={sql === (saved ?? "")}
            onClick={() => {
              setSql(saved ?? "");
              workspace.setDirty(false);
            }}
          >
            Entwurf verwerfen
          </Button>
        </div>
        {target && (
          <div className="space-y-3 border-t border-border/50 pt-4">
            <p className="text-xs leading-relaxed">
              Seed-Daten in <strong>{target.name}</strong> einfügen. SQL wird in einer Transaktion
              ausgeführt; Hauptbranches und Produktionsziele sind auch im Backend gesperrt.
            </p>
            <Input
              aria-label="Seed-Ausführung bestätigen"
              placeholder={`Zielname eingeben: ${target.name}`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button
              disabled={
                !target.release ||
                !connection ||
                connection.readOnly ||
                confirmation !== target.name ||
                sql !== saved ||
                !sql.trim()
              }
              onClick={() => void run(execute)}
            >
              Gespeicherten Seed ausführen
            </Button>
          </div>
        )}
      </fieldset>
      {loadError && (
        <p role="alert" className="text-xs text-destructive">
          {loadError}
        </p>
      )}
      {!loaded && !loadError && (
        <p role="status" className="text-xs text-muted-foreground">
          Seed-Datei laden…
        </p>
      )}
      <a
        href="https://supabase.com/docs/guides/local-development/seeding-your-database"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[11px] text-muted-foreground underline underline-offset-4"
      >
        Ablauf nach Supabase Seed-Dateien
      </a>
    </section>
  );
}
