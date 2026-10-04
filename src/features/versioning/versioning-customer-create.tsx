import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { STAGE_LABELS } from "@/lib/versioning/delivery";
import { addTarget } from "@/lib/versioning/targets";
import type { VersioningWorkspace } from "./use-versioning";
import {
  type EnvironmentValue,
  VersioningEnvironmentFields,
} from "./versioning-environment-fields";

const EMPTY: EnvironmentValue = { connectionId: "", database: "", schema: "" };

export function VersioningCustomerCreate({
  workspace,
  onDone,
}: {
  workspace: VersioningWorkspace;
  onDone: () => void;
}) {
  const { repo, project, run, refresh } = workspace;
  const connections = useConnectionsStore((state) => state.connections);
  const [customer, setCustomer] = useState("");
  const [test, setTest] = useState(EMPTY);
  const [production, setProduction] = useState(EMPTY);
  if (!project) return null;
  const complete = (value: EnvironmentValue) => Boolean(value.connectionId && value.schema.trim());
  const sourceSchemas = new Set(project.objects.map((object) => object.selection.schema));
  const create = () =>
    void run(async () => {
      const created: string[] = [];
      try {
        for (const [stage, value] of [
          ["test", test],
          ["production", production],
        ] as const) {
          if (!complete(value)) continue;
          await addTarget(repo, project, connections, {
            name: `${customer.trim()} · ${STAGE_LABELS[stage]}`,
            customer,
            environment: STAGE_LABELS[stage],
            connectionId: value.connectionId,
            database: value.database,
            schema: value.schema,
            production: stage === "production",
            stage,
          });
          created.push(STAGE_LABELS[stage]);
        }
      } catch (error) {
        throw new Error(
          created.length
            ? `${created.join(" und ")} angelegt, danach fehlgeschlagen: ${error instanceof Error ? error.message : error}`
            : String(error),
        );
      } finally {
        await refresh();
      }
      onDone();
    }, "Kunde angelegt");
  return (
    <form
      className="space-y-4 rounded-xl bg-muted/35 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <div>
        <h3 className="text-xs font-semibold">Kunde mit Test- und Produktivsystem</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Beide Systeme nutzen dasselbe Produkt aus diesem Repository, aber getrennte Verbindungen.
          Eine Baseline wird danach je System im Kundenbereich geprüft.
        </p>
      </div>
      <label htmlFor="vcs-customer-name" className="block space-y-1.5 text-xs font-medium">
        Kunde
        <Input
          id="vcs-customer-name"
          aria-label="Kundenname"
          placeholder="z. B. Stadtwerke Nord"
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <VersioningEnvironmentFields
          label="Testsystem"
          project={project}
          value={test}
          onChange={setTest}
        />
        <VersioningEnvironmentFields
          label="Produktivsystem"
          project={project}
          value={production}
          onChange={setProduction}
        />
      </div>
      {sourceSchemas.size !== 1 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Vor der Zuordnung genau ein Quellschema unter Änderungen aufnehmen.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            !customer.trim() ||
            sourceSchemas.size !== 1 ||
            (!complete(test) && !complete(production))
          }
        >
          Kunde anlegen
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
