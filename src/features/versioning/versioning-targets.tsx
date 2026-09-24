import {
  ArrowRightIcon,
  CircleAlertIcon,
  DatabaseIcon,
  EllipsisIcon,
  PlusIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  ServerIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";
import { control } from "@/lib/versioning/control";
import { baselineTarget, type DeploymentPlan, inspectTarget } from "@/lib/versioning/deploy";
import { deployFleet, type FleetResult, preflightFleet } from "@/lib/versioning/fleet";
import { addTarget } from "@/lib/versioning/targets";
import type { DatabaseTarget, ObjectDifference } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";
import { VersioningTargetPolicy } from "./versioning-target-policy";

export function VersioningTargets({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, releases, targets, run, refresh } = workspace;
  const connections = useConnectionsStore((state) => state.connections);
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const [schemaError, setSchemaError] = useState("");
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [production, setProduction] = useState(true);
  const [releaseId, setReleaseId] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [differenceName, setDifferenceName] = useState("");
  const [differences, setDifferences] = useState<ObjectDifference[]>([]);
  const [plans, setPlans] = useState<DeploymentPlan[]>([]);
  const [preflight, setPreflight] = useState<FleetResult[]>([]);
  const [recovery, setRecovery] = useState<DatabaseTarget | null>(null);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [waveLimit, setWaveLimit] = useState("1");
  const [confirmation, setConfirmation] = useState("");
  const selectedConnection = connections.find((entry) => entry.id === connectionId);
  const sourceSchema = [
    ...new Set(project?.objects.map((object) => object.selection.schema) ?? []),
  ];
  useEffect(() => {
    const latest = releases.filter((release) => (release.track ?? "main") === "main").at(-1);
    setReleaseId((current) =>
      releases.some((release) => release.id === current) ? current : (latest?.id ?? ""),
    );
  }, [releases]);
  useEffect(() => {
    if (!setupOpen || !selectedConnection) {
      setAvailableSchemas([]);
      setSchemaError("");
      return;
    }
    let active = true;
    setLoadingSchemas(true);
    setSchemaError("");
    Promise.resolve()
      .then(() =>
        listSchemas(
          selectedConnection.kind,
          effectiveConnectionString(selectedConnection),
          database.trim() || undefined,
        ),
      )
      .then((items) => {
        if (!active) return;
        setAvailableSchemas(items);
        setSchema((current) => current || (items.length === 1 ? items[0] : ""));
      })
      .catch((cause) => {
        if (active) {
          setAvailableSchemas([]);
          setSchemaError(String(cause));
        }
      })
      .finally(() => {
        if (active) setLoadingSchemas(false);
      });
    return () => {
      active = false;
    };
  }, [setupOpen, selectedConnection, database]);
  const connectionFor = (target: DatabaseTarget) => {
    const connection = connections.find((entry) => entry.id === target.connectionId);
    if (!connection) throw new Error(`Verbindung für ${target.name} fehlt.`);
    return connection;
  };
  const add = async () => {
    if (!project) throw new Error("Projekt fehlt.");
    const created = await addTarget(repo, project, connections, {
      name,
      connectionId,
      database,
      schema,
      production,
    });
    await refresh();
    setSelection([created.id]);
    setSetupOpen(false);
    setName("");
    setSchema("");
  };
  const plan = async () => {
    if (!project || !targets || !releaseId) throw new Error("Ziele und Zielrelease auswählen.");
    setPlans([]);
    setPreflight([]);
    setConfirmation("");
    const result = await preflightFleet(
      repo,
      project,
      targets.targets.filter((item) => selection.includes(item.id)),
      connections,
      releaseId,
    );
    setPreflight(result);
    setPlans(result.flatMap((item) => (item.plan ? [item.plan] : [])));
  };
  const execute = async () => {
    if (!project || !plans.length || confirmation !== releaseId)
      throw new Error("Zur Bestätigung die Release-ID eingeben.");
    try {
      if (preflight.some((item) => item.error))
        throw new Error("Alle ausgewählten Ziele müssen die Vorprüfung bestehen.");
      await deployFleet(
        repo,
        project,
        plans,
        connections,
        releaseId,
        workspace.setMessage,
        Number(waveLimit),
      );
      workspace.setMessage(
        "Welle abgeschlossen. Betrieb prüfen und verbleibende Ziele neu planen.",
      );
    } finally {
      setPlans([]);
      setPreflight([]);
      setConfirmation("");
      await refresh();
    }
  };
  if (!project || !targets) return null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="text-xs font-semibold">Kundenziele</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {targets.targets.length} Datenbank-Schema-Zuordnungen · unabhängig versioniert
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={setupOpen}
          onClick={() => setSetupOpen((open) => !open)}
        >
          <PlusIcon className="size-3.5" />
          Kundenziel hinzufügen
        </Button>
      </div>
      {setupOpen && (
        <div className="space-y-4 rounded-xl bg-muted/35 p-4">
          <div>
            <h3 className="text-xs font-semibold">Kundenschema zuordnen</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Die Zuordnung speichert nur das Ziel. Eine Baseline wird erst nach Prüfung des
              vorhandenen Schemas gesetzt.
            </p>
          </div>
          <label htmlFor="vcs-target-name" className="space-y-1.5 text-xs font-medium">
            Kunde / Umgebung
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
            onChange={(value) => {
              setConnectionId(value);
              const connection = connections.find((item) => item.id === value);
              setDatabase(
                connection ? (databaseFromConnectionString(connection.connectionString) ?? "") : "",
              );
              setSchema("");
            }}
            placeholder="Verbindung auswählen"
            options={connections
              .filter((connection) => connection.kind === project.kind)
              .map((connection) => ({ value: connection.id, label: connection.name }))}
          />
          <label className="space-y-1.5 text-xs font-medium" htmlFor="vcs-target-database">
            Datenbank
            <Input
              id="vcs-target-database"
              aria-label="Zieldatenbank"
              placeholder="Datenbank der Verbindung"
              value={database}
              onChange={(event) => {
                setDatabase(event.target.value);
                setSchema("");
              }}
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium" htmlFor="vcs-target-schema">
            Kundenschema
            <Input
              id="vcs-target-schema"
              aria-label="Zielschema"
              list="vcs-target-schemas"
              placeholder={loadingSchemas ? "Schemas werden geladen" : "Vorhandenes Schema wählen"}
              value={schema}
              onChange={(event) => setSchema(event.target.value)}
            />
            <datalist id="vcs-target-schemas">
              {availableSchemas.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          {schemaError && (
            <p role="alert" className="text-xs text-destructive">
              {schemaError}
            </p>
          )}
          {sourceSchema.length === 1 && schema && (
            <p className="text-[11px] text-muted-foreground">
              Zuordnung: <span className="font-mono">{sourceSchema[0]}</span> →{" "}
              <span className="font-mono">{schema}</span>
            </p>
          )}
          {sourceSchema.length !== 1 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Vor der Zuordnung genau ein Quellschema unter Änderungen aufnehmen.
            </p>
          )}
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
            disabled={
              !name.trim() ||
              !connectionId ||
              !schema.trim() ||
              loadingSchemas ||
              Boolean(schemaError) ||
              sourceSchema.length !== 1
            }
            onClick={() => void run(add, "Datenbank zugeordnet")}
          >
            Kundenziel speichern
          </Button>
        </div>
      )}
      {targets.targets.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <VersioningSelect
              label="Zielrelease"
              value={releaseId}
              onChange={(value) => {
                setReleaseId(value);
                setPlans([]);
                setPreflight([]);
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
                  setPreflight([]);
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
                  {connections.find((entry) => entry.id === target.connectionId)?.name ??
                    "Verbindung fehlt"}
                  {target.database ? ` · ${target.database}` : ""}
                  {target.schema ? ` / ${target.schema}` : ""} ·{" "}
                  {target.production ? "Produktion" : "Test"}
                </p>
                {unresolved && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <CircleAlertIcon className="size-3" />
                    Stand abgleichen
                  </p>
                )}
                {(target.paused || target.pinnedRelease || target.track) && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {target.track ?? "main"}
                    {target.paused ? " · Pausiert" : ""}
                    {target.pinnedRelease ? ` · Max. ${target.pinnedRelease}` : ""}
                  </p>
                )}
                {!target.release && releaseId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7 px-2 text-[11px]"
                    onClick={() =>
                      void run(async () => {
                        await baselineTarget(
                          repo,
                          project,
                          target.id,
                          connectionFor(target),
                          releaseId,
                          false,
                          connections,
                        );
                        await refresh();
                      }, "Baseline geprüft und zugeordnet")
                    }
                  >
                    Baseline {releaseId} prüfen
                  </Button>
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
                    : "Für den Abgleich zuerst einen Zielrelease auswählen."}
                </p>
                <VersioningTargetPolicy
                  workspace={workspace}
                  target={target}
                  onSaved={() => {
                    setPlans([]);
                    setPreflight([]);
                  }}
                />
              </VersioningPopover>
            </li>
          );
        })}
      </ul>
      {!targets.targets.length && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <DatabaseIcon className="size-7 text-muted-foreground/40" strokeWidth={1.4} />
          <p className="text-xs font-medium">Jedes Kundenschema auf seinem Stand</p>
          <p className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
            Wähle für jeden Kunden die Connection, Datenbank und das vorhandene Schema. Danach wird
            der Ausgangsstand geprüft.
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
            Datenzeilen nicht bestätigen. Ein aktiver Rollout blockiert den Abgleich.
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
                    connections,
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
      {preflight.some((item) => item.error) && (
        <div
          role="alert"
          className="space-y-2 rounded-lg bg-destructive/5 p-3 text-xs text-destructive"
        >
          <p className="font-medium">Rollout blockiert · keine Änderungen ausgeführt</p>
          {preflight
            .filter((item) => item.error)
            .map((item) => (
              <p key={item.target.id}>
                {item.target.name}: {item.error}
              </p>
            ))}
        </div>
      )}
      {plans.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/35 p-4">
          <h2 className="text-xs font-semibold">Rollout prüfen</h2>
          <p className="text-[11px] text-muted-foreground">
            Vor dem Start werden alle ausgewählten Ziele erneut geprüft. Freigabe: 15 Minuten.
            Spätere Release-Vorbedingungen werden nach ihren Vorgängern geprüft.
          </p>
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
              <p className="mt-2 text-muted-foreground">
                {item.binding.label}
                {item.binding.edition ? ` · Edition ${item.binding.edition}` : ""}
              </p>
              {item.policy.policy.requireApproval && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(async () => {
                      await control(
                        connectionFor(item.target),
                        project,
                        item.target,
                        "request-review",
                        { body: item.reviewArtifact },
                      );
                    }, "Freigabe angefragt – zweiter Datenbankbenutzer prüft unter Aktivität")
                  }
                >
                  Freigabe anfragen
                </Button>
              )}
              {!item.releases.length && <p>Bereits auf dem Zielstand · wird übersprungen.</p>}
              {item.risks.map((risk) => (
                <p className="mt-2 text-amber-700 dark:text-amber-300" key={risk}>
                  {risk}
                </p>
              ))}
              {item.releases.map((release) => (
                <div className="mt-3 space-y-1" key={release.id}>
                  <p className="font-medium">
                    {release.id} · {release.safety?.phase ?? "Ohne Betriebsplan"}
                  </p>
                  <p>{release.safety?.notes}</p>
                  <p>
                    Vorprüfungen:{" "}
                    {release.safety?.preconditions.map((check) => check.title).join(", ") ||
                      "Keine"}
                  </p>
                  <p>
                    Nachprüfungen:{" "}
                    {release.safety?.postconditions.map((check) => check.title).join(", ") ||
                      "Keine"}
                  </p>
                </div>
              ))}
            </details>
          ))}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Ziele werden nacheinander aktualisiert. Beim ersten Fehler stoppt der Rollout.{" "}
            {project.kind === "oracle"
              ? "Oracle-DDL kann bei einem Fehler bereits gespeichert sein."
              : "Jeder Release wird in einer eigenen Transaktion ausgeführt."}
          </p>
          <VersioningSelect
            label="Rollout-Welle"
            value={waveLimit}
            onChange={setWaveLimit}
            options={[
              { value: "1", label: "Canary · zunächst eine Datenbank" },
              { value: "5", label: "Welle · bis zu 5 Datenbanken" },
              { value: "10", label: "Welle · bis zu 10 Datenbanken" },
              { value: "1000", label: "Große Welle · bis zu 1.000 Datenbanken" },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Nach jeder Welle Anwendung und Betrieb prüfen. Verbleibende Ziele anschließend neu
            planen und ausdrücklich starten.
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
              preflight.some((item) => item.error) ||
              plans.every((item) => !item.releases.length) ||
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
