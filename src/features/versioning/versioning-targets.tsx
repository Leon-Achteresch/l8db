import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Ein Repository, unabhängige Kundenstände. Verbindungszuordnungen und Deployment-Historie
        bleiben lokal im Git-Verzeichnis; Zugangsdaten werden nicht versioniert.
      </p>
      <div className="flex flex-wrap gap-2 rounded border p-3">
        <Input
          aria-label="Kundenname"
          placeholder="Kunde / Umgebung"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-48"
        />
        <select
          aria-label="Zielverbindung"
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
          className="rounded border bg-background p-2 text-sm"
        >
          <option value="">Verbindung auswählen</option>
          {connections
            .filter((connection) => connection.kind === project.kind)
            .map((connection) => (
              <option value={connection.id} key={connection.id}>
                {connection.name}
              </option>
            ))}
        </select>
        <Input
          aria-label="Zieldatenbank"
          placeholder="Datenbank (Verbindungsstandard)"
          value={database}
          onChange={(event) => setDatabase(event.target.value)}
          className="w-64"
        />
        <Input
          aria-label="Zielschema"
          placeholder="Schema (wie im Projekt)"
          value={schema}
          onChange={(event) => setSchema(event.target.value)}
          className="w-52"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={production}
            onChange={(event) => setProduction(event.target.checked)}
          />
          Produktion
        </label>
        <Button onClick={() => void run(add)}>Datenbank zuordnen</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Zielrelease"
          className="rounded border bg-background p-2 text-sm"
          value={releaseId}
          onChange={(event) => {
            setReleaseId(event.target.value);
            setPlans([]);
          }}
        >
          <option value="">Zielrelease auswählen</option>
          {releases.map((release) => (
            <option key={release.id}>{release.id}</option>
          ))}
        </select>
        <Button disabled={!selection.length || !releaseId} onClick={() => void run(plan)}>
          Update für {selection.length} Ziele planen
        </Button>
      </div>
      <div className="overflow-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3">Auswahl</th>
              <th>Kunde / Umgebung</th>
              <th>Release</th>
              <th>Letztes Deployment</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {targets.targets.map((target) => (
              <tr className="border-t" key={target.id}>
                <td className="p-3">
                  <input
                    type="checkbox"
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
                </td>
                <td>
                  {target.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {target.production ? "Produktion" : "Test"}
                  </span>
                </td>
                <td>{target.release?.id ?? "Nicht zugeordnet"}</td>
                <td>{target.history[0]?.status ?? "—"}</td>
                <td className="flex flex-wrap gap-1 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!target.release}
                    onClick={() =>
                      void run(async () => {
                        const result = await inspectTarget(
                          repo,
                          project,
                          target,
                          connectionFor(target),
                        );
                        setDifferences(result.differences);
                        workspace.setMessage(`Stand geprüft: ${target.name}`);
                      })
                    }
                  >
                    Stand prüfen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!releaseId || Boolean(target.release)}
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
                      }, "Baseline anhand tatsächlicher Definitionen geprüft und zugeordnet")
                    }
                  >
                    Baseline zuordnen
                  </Button>
                  {releaseId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!releaseId}
                      onClick={() => {
                        setRecovery(target);
                        setRecoveryConfirmation("");
                      }}
                    >
                      Stand abgleichen
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!targets.targets.length && (
          <p className="p-4 text-sm text-muted-foreground">
            Noch keine Kundendatenbanken zugeordnet.
          </p>
        )}
      </div>
      {recovery && (
        <div
          role="dialog"
          aria-label="Stand abgleichen"
          className="flex flex-col gap-3 rounded border border-amber-500/50 p-4"
        >
          <h2 className="font-semibold">{recovery.name}: Stand abgleichen</h2>
          <p className="text-sm">
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
        <div className="rounded border p-3">
          <h2 className="mb-2 font-semibold">Prüfergebnis der verwalteten Objekte</h2>
          {differences.map((difference) => (
            <details key={difference.id} className="border-t py-2">
              <summary>
                {difference.label}:{" "}
                {difference.status === "unchanged" ? "Entspricht Release" : "Abweichung"}
              </summary>
              <div className="grid gap-2 md:grid-cols-2">
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
        <div className="flex flex-col gap-3 rounded border p-4">
          <h2 className="font-semibold">Rollout prüfen</h2>
          {plans.map((item) => (
            <details key={item.target.id}>
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
          <p className="text-sm text-muted-foreground">
            Ziele werden nacheinander aktualisiert. Beim ersten Fehler stoppt der Rollout.{" "}
            {project.kind === "oracle"
              ? "Oracle-DDL kann bei einem Fehler bereits gespeichert sein."
              : "Jeder Release wird in einer eigenen Transaktion ausgeführt."}
          </p>
          <label className="text-sm" htmlFor="versioning-deploy-confirmation">
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
      <details>
        <summary className="text-sm">Deployment-Historie</summary>
        {targets.targets.flatMap((target) =>
          target.history.map((event) => (
            <div key={event.id} className="mt-2 rounded border p-3 text-xs">
              <p>
                {target.name} · {event.from?.id ?? "—"} → {event.to.id} · {event.status}
              </p>
              <p>
                {event.startedAt} · Migrationen:{" "}
                {event.completedMigrations.join(", ") || "Keine bestätigt"}
              </p>
              {event.error && (
                <pre className="mt-1 whitespace-pre-wrap text-destructive">{event.error}</pre>
              )}
            </div>
          )),
        )}
      </details>
    </div>
  );
}
