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
  const ready =
    Boolean(customer.trim()) &&
    sourceSchemas.size === 1 &&
    (complete(test) || complete(production));
  return (
    <form
      aria-label="Neuer Kunde"
      className="space-y-3 rounded-2xl bg-muted/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target === event.currentTarget) onDone();
      }}
    >
      <div className="flex items-center gap-3">
        <h3 className="shrink-0 text-[13px] font-semibold tracking-tight">Neuer Kunde</h3>
        <Input
          id="vcs-customer-name"
          aria-label="Kundenname"
          placeholder="Kundenname"
          autoFocus
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDone();
          }}
          className="h-9 rounded-lg bg-background/70 text-[13px] font-medium"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <VersioningEnvironmentFields
          label="Testsystem"
          tone="test"
          project={project}
          value={test}
          onChange={setTest}
        />
        <VersioningEnvironmentFields
          label="Produktivsystem"
          tone="production"
          project={project}
          value={production}
          onChange={setProduction}
        />
      </div>
      <div className="flex items-center gap-2">
        {sourceSchemas.size !== 1 && (
          <p className="mr-auto text-[11px] text-amber-700 dark:text-amber-300">
            Zuerst genau ein Quellschema unter Änderungen aufnehmen
          </p>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-8 rounded-full px-4 text-xs"
          onClick={onDone}
        >
          Abbrechen
        </Button>
        <Button type="submit" size="sm" className="h-8 rounded-full px-4 text-xs" disabled={!ready}>
          Kunde anlegen
        </Button>
      </div>
    </form>
  );
}
