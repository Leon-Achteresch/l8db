import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeTarget, updateTargetDetails } from "@/lib/versioning/targets";
import type { DatabaseTarget } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";

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
              Entfernt die lokale Zuordnung samt lokalem Verlauf. Die Datenbank und ihr Journal
              bleiben erhalten.
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
                }, "Lokale Zuordnung entfernt")
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
