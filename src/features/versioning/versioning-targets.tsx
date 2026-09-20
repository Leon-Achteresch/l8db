import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseIcon,
  EllipsisIcon,
  PlusIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  ServerIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { cn } from "@/lib/utils";
import {
  baselineTarget,
  type DeploymentPlan,
  deploy,
  inspectTarget,
  planDeployment,
} from "@/lib/versioning/deploy";
import { readTargets, saveTargets } from "@/lib/versioning/repository";
import type { DatabaseTarget, ObjectDifference } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";

export function VersioningTargets({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, releases, targets, run, refresh } = workspace;
  const connections = useConnectionsStore((state) => state.connections);
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("");
  const [production, setProduction] = useState(true);
  const [releaseId, setReleaseId] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [differenceName, setDifferenceName] = useState("");
  const [differences, setDifferences] = useState<ObjectDifference[]>([]);
  const [plans, setPlans] = useState<DeploymentPlan[]>([]);
  const [recovery, setRecovery] = useState<DatabaseTarget | null>(null);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const connectionFor = (target: DatabaseTarget) => {
    const connection = connections.find((entry) => entry.id === target.connectionId);
    if (!connection) throw new Error(`Verbindung für ${target.name} fehlt.`);
    return connection;
  };
  const add = async () => {
    if (!project || !name.trim() || !connectionId)
      throw new Error("Name und Verbindung auswählen.");
    const { store, text } = await readTargets(repo, project.id);
    if (
      store.targets.some(
        (target) =>
          target.connectionId === connectionId &&
          target.database === (database.trim() || null) &&
          (target.schema ?? null) === (schema.trim() || null),
      )
    )
      throw new Error("Diese Verbindung und Datenbank sind bereits zugeordnet.");
    store.targets.push({
      id: crypto.randomUUID(),
      name: name.trim(),
      connectionId,
      database: database.trim() || null,
      production,
      schema: schema.trim() || null,
      release: null,
      history: [],
    });
    await saveTargets(repo, store, text);
    await refresh();
    setName("");
  };
  const plan = async () => {
    if (!project || !targets || !releaseId) throw new Error("Ziele und Zielrelease auswählen.");
    setPlans([]);
    setConfirmation("");
    const result: DeploymentPlan[] = [];
    for (const target of targets.targets.filter((item) => selection.includes(item.id)))
      result.push(await planDeployment(repo, project, target, connectionFor(target), releaseId));
    setPlans(result);
  };
  const execute = async () => {
    if (!project || !plans.length || confirmation !== releaseId)
      throw new Error("Zur Bestätigung die Release-ID eingeben.");
    try {
      for (const item of plans)
        await deploy(
          repo,
          project,
          item.target.id,
          connectionFor(item.target),
          releaseId,
          item.reviewToken,
          workspace.setMessage,
        );
      workspace.setMessage("Rollout abgeschlossen.");
    } finally {
      setPlans([]);
      setConfirmation("");
      await refresh();
    }
  };
  if (!project || !targets) return null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="text-xs font-semibold">Kundendatenbanken</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {targets.targets.length} Ziele · unabhängig versioniert
          </p>
        </div>
        <VersioningPopover icon={PlusIcon} label="Datenbank hinzufügen" disabled={workspace.busy}>
          <label htmlFor="vcs-target-name" className="space-y-1.5 text-xs font-medium">
            Name
            <Input
              id="vcs-target-name"
              aria-label="Kundenname"
              placeholder="Kunde / Umgebung"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <VersioningSelect
            label="Zielverbindung"
            value={connectionId}
            onChange={setConnectionId}
            placeholder="Verbindung auswählen"
            options={connections
              .filter((connection) => connection.kind === project.kind)
              .map((connection) => ({ value: connection.id, label: connection.name }))}
          />
          <Input
            aria-label="Zieldatenbank"
            placeholder="Datenbank (Verbindungsstandard)"
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
          />
          <Input
            aria-label="Zielschema"
            placeholder="Schema (wie im Projekt)"
            value={schema}
            onChange={(event) => setSchema(event.target.value)}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={production}
              onChange={(event) => setProduction(event.target.checked)}
            />
            Produktionsumgebung
          </label>
          <Button
            size="sm"
            disabled={!name.trim() || !connectionId}
            onClick={() => void run(add, "Datenbank zugeordnet")}
          >
            Datenbank zuordnen
          </Button>
        </VersioningPopover>
      </div>
      {targets.targets.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <VersioningSelect
              label="Zielrelease"
              value={releaseId}
              onChange={(value) => {
                setReleaseId(value);
                setPlans([]);
                setRecovery(null);
              }}
              placeholder="Zielrelease auswählen"
              options={releases.map((release) => ({ value: release.id, label: release.id }))}
            />
          </div>
          <Button
            size="sm"
            aria-label={`Update für ${selection.length} Ziele planen`}
            disabled={!selection.length || !releaseId}
            onClick={() => void run(plan)}
          >
            Planen
            {selection.length > 0 && (
              <span className="tabular-nums opacity-60">{selection.length}</span>
            )}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </div>
      )}
      <ul className="space-y-1">
        {targets.targets.map((target) => {
          const unresolved = target.history.some(
            (event) => event.status === "running" || event.status === "failed",
          );
          return (
            <li
              key={target.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-3 transition-colors hover:bg-muted/30",
                selection.includes(target.id) && "bg-muted/40",
              )}
            >
              <input
                type="checkbox"
                className="size-3.5 shrink-0"
                aria-label={`Ziel auswählen: ${target.name}`}
                checked={selection.includes(target.id)}
                onChange={(event) => {
                  setSelection((items) =>
                    event.target.checked
                      ? [...items, target.id]
                      : items.filter((item) => item !== target.id),
                  );
                  setPlans([]);
                }}
              />
              <ServerIcon className="size-4 shrink-0 text-muted-foreground/60" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="truncate">{target.name}</span>
                  {target.production && (
                    <span
                      className="size-1 shrink-0 rounded-full bg-amber-500"
                      title="Produktion"
                    />
                  )}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {target.database ??
                    connections.find((entry) => entry.id === target.connectionId)?.name ??
                    "Verbindung fehlt"}
                  {target.schema ? ` / ${target.schema}` : ""} ·{" "}
                  {target.production ? "Produktion" : "Test"}
                </p>
                {unresolved && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <CircleAlertIcon className="size-3" />
                    Stand abgleichen
                  </p>
                )}
              </div>
              <span className="max-w-24 truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {target.release?.id ?? "Ohne Baseline"}
              </span>
              <VersioningPopover
                icon={EllipsisIcon}
                label={`Aktionen: ${target.name}`}
                disabled={workspace.busy}
                className="w-64"
              >
                <button
                  type="button"
                  disabled={!target.release}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-40"
                  onClick={() =>
                    void run(async () => {
                      const result = await inspectTarget(
                        repo,
                        project,
                        target,
                        connectionFor(target),
                      );
                      setDifferenceName(target.name);
                      setDifferences(result.differences);
                      workspace.setMessage(`Stand geprüft: ${target.name}`);
                    })
                  }
                >
                  <ScanSearchIcon className="size-4 text-muted-foreground" />
                  Stand prüfen
                </button>
                <button
                  type="button"
                  disabled={!releaseId || Boolean(target.release)}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-40"
                  onClick={() =>
                    void run(async () => {
                      await baselineTarget(
                        repo,
                        project,
                        target.id,
                        connectionFor(target),
                        releaseId,
                      );
                      await refresh();
                    }, "Baseline geprüft und zugeordnet")
                  }
                >
                  <CheckCircle2Icon className="size-4 text-muted-foreground" />
                  Baseline zuordnen
                </button>
                <button
                  type="button"
                  disabled={!releaseId}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-40"
                  onClick={() => {
                    setRecovery(target);
                    setRecoveryConfirmation("");
                  }}
                >
                  <RefreshCwIcon className="size-4 text-muted-foreground" />
                  Stand abgleichen
                </button>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {releaseId
                    ? `Gewählter Release: ${releaseId}`
                    : "Für Baseline und Abgleich zuerst einen Zielrelease auswählen."}
                </p>
              </VersioningPopover>
            </li>
          );
        })}
      </ul>
      {!targets.targets.length && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <DatabaseIcon className="size-7 text-muted-foreground/40" strokeWidth={1.4} />
          <p className="text-xs font-medium">Jede Datenbank auf ihrem Stand</p>
          <p className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
            Ordne eine Umgebung oder deine Kundendatenbanken über das Plus hinzu.
          </p>
        </div>
      )}
      {recovery && (
        <div
          role="dialog"
          aria-label="Stand abgleichen"
          className="flex flex-col gap-3 rounded-lg bg-amber-500/5 p-4"
        >
          <h2 className="text-xs font-semibold">{recovery.name}: Stand abgleichen</h2>
          <p className="text-xs leading-relaxed">
            Vorher sicherstellen, dass kein Deployment mehr läuft und alle Datenmigrationen manuell
            geprüft oder repariert wurden. Der Schema-Vergleich allein kann Änderungen an
            Datenzeilen nicht bestätigen. Die Freigabe hebt auch die Datenbank-Sperre auf.
          </p>
          <Input
            aria-label="Wiederherstellung bestätigen"
            placeholder={`Geprüften Release ${releaseId} eingeben`}
            value={recoveryConfirmation}
            onChange={(event) => setRecoveryConfirmation(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={!releaseId || recoveryConfirmation !== releaseId}
              onClick={() =>
                void run(async () => {
                  await baselineTarget(
                    repo,
                    project,
                    recovery.id,
                    connectionFor(recovery),
                    releaseId,
                    true,
                  );
                  setRecovery(null);
                  await refresh();
                }, "Geprüfter Datenbankstand abgeglichen")
              }
            >
              Manuell geprüften Stand freigeben
            </Button>
            <Button variant="outline" onClick={() => setRecovery(null)}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}
      {differences.length > 0 && (
        <div className="space-y-2">
          <h2 className="mb-2 text-xs font-semibold">Standprüfung · {differenceName}</h2>
          {differences.map((difference) => (
            <details key={difference.id} className="rounded-lg bg-muted/30 p-3 text-xs">
              <summary>
                {difference.label}:{" "}
                {difference.status === "unchanged" ? "Entspricht Release" : "Abweichung"}
              </summary>
              <div className="mt-3 grid gap-3">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {difference.expected}
                </pre>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {difference.actual}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
      {plans.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/35 p-4">
          <h2 className="text-xs font-semibold">Rollout prüfen</h2>
          {plans.map((item) => (
            <details key={item.target.id} className="text-xs leading-relaxed">
              <summary>
                {item.target.name}: {item.from.id} → {item.to.id} · {item.releases.length} Releases
                ·{" "}
                {item.differences.filter((difference) => difference.status !== "unchanged").length}{" "}
                Abweichungen
              </summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {item.sql.join("\n\n")}
              </pre>
            </details>
          ))}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Ziele werden nacheinander aktualisiert. Beim ersten Fehler stoppt der Rollout.{" "}
            {project.kind === "oracle"
              ? "Oracle-DDL kann bei einem Fehler bereits gespeichert sein."
              : "Jeder Release wird in einer eigenen Transaktion ausgeführt."}
          </p>
          <label className="text-xs leading-relaxed" htmlFor="versioning-deploy-confirmation">
            Release-ID zur Bestätigung eingeben
            <Input
              id="versioning-deploy-confirmation"
              aria-label="Deployment bestätigen"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <Button
            disabled={
              confirmation !== releaseId ||
              plans.some((item) =>
                item.differences.some((difference) => difference.status !== "unchanged"),
              )
            }
            onClick={() => void run(execute)}
          >
            Geprüften Rollout ausführen
          </Button>
        </div>
      )}
    </div>
  );
}
