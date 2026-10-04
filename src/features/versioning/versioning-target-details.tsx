import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STAGE_LABELS, targetStage } from "@/lib/versioning/delivery";
import { removeTarget, updateTargetDetails } from "@/lib/versioning/targets";
import type { DatabaseTarget, TargetStage } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

export function VersioningTargetDetails({
  workspace,
  target,
  onSaved,
}: {
  workspace: VersioningWorkspace;
  target: DatabaseTarget;
  onSaved: () => void;
}) {
  const [customer, setCustomer] = useState(target.customer || target.name);
  const [environment, setEnvironment] = useState(
    target.environment || (target.production ? "Produktion" : "Development"),
  );
  const [name, setName] = useState(target.name);
  const [stage, setStage] = useState<TargetStage>(targetStage(target));
  const [removing, setRemoving] = useState(false);
  return (
    <details className="border-t border-border/50 pt-3 text-xs">
      <summary className="cursor-pointer font-medium">Kundenzuordnung bearbeiten</summary>
      <div className="mt-3 space-y-3">
        <Input
          aria-label="Kunde bearbeiten"
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
        />
        <Input
          aria-label="Umgebung bearbeiten"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
        />
        <Input
          aria-label="Zielname bearbeiten"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {!target.production && (
          <VersioningSelect
            label="Stufe"
            value={stage}
            onChange={(value) => setStage(value as TargetStage)}
            options={(["test", "development"] as const).map((value) => ({
              value,
              label: STAGE_LABELS[value],
            }))}
          />
        )}
        <Button
          size="sm"
          disabled={!customer.trim() || !environment.trim() || !name.trim()}
          onClick={() =>
            void workspace.run(async () => {
              if (!workspace.project) return;
              await updateTargetDetails(workspace.repo, workspace.project.id, target.id, {
                name,
                customer,
                environment,
                stage: target.production ? target.stage : stage,
              });
              onSaved();
              await workspace.refresh();
            }, "Kundenzuordnung gespeichert")
          }
        >
          Zuordnung speichern
        </Button>
        {removing ? (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Entfernt das Ziel aus der gemeinsamen Git-Konfiguration. Die Datenbank und ihr Journal
              bleiben erhalten. Die Änderung kann in Git geprüft und zurückgenommen werden.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                void workspace.run(async () => {
                  if (!workspace.project) return;
                  await removeTarget(workspace.repo, workspace.project.id, target.id);
                  onSaved();
                  await workspace.refresh();
                }, "Zuordnung aus Git-Konfiguration entfernt")
              }
            >
              Zuordnung entfernen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(false)}>
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
            Zuordnung entfernen…
          </Button>
        )}
      </div>
    </details>
  );
}
