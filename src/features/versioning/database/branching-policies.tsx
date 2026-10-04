import type { ReactNode } from "react";
import { MaskingEditor } from "./masking-editor";
import { ProtectionSettings } from "./protection-settings";
import { ScheduleSettings } from "./schedule-settings";
import type { BranchingWorkspace } from "./use-branching";
import { VaultSettings } from "./vault-settings";

export function BranchingPolicies({ workspace }: { workspace: BranchingWorkspace }) {
  if (!workspace.overview) return null;
  const sections: { id: string; title: string; description: string; body: ReactNode }[] = [
    {
      id: "protection",
      title: "Schutzstufe",
      description: `Gilt für „${workspace.overview.root}“ und wird in der Datenbank selbst gespeichert – damit für alle l8db-Nutzer verbindlich.`,
      body: <ProtectionSettings workspace={workspace} />,
    },
    {
      id: "masking",
      title: "Maskierung",
      description:
        "Legt fest, wie personenbezogene Daten in anonymisierten Branches ersetzt werden. Pseudonyme sind pro Tresor stabil, Fremdschlüssel bleiben gültig.",
      body: <MaskingEditor workspace={workspace} />,
    },
    {
      id: "schedule",
      title: "Automatik und Aufbewahrung",
      description:
        "Geplante Sicherungen und Standard-Ablaufzeiten für diese Datenbank-Familie auf diesem Rechner.",
      body: <ScheduleSettings workspace={workspace} />,
    },
    {
      id: "vault",
      title: "Tresor",
      description:
        "Der Schlüssel liegt im Schlüsselbund des Betriebssystems. Ohne Wiederherstellungsschlüssel sind Sicherungen auf anderen Rechnern nicht lesbar.",
      body: <VaultSettings workspace={workspace} />,
    },
  ];
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`branching-policy-${section.id}`}
          className="space-y-3"
        >
          <div>
            <h3 id={`branching-policy-${section.id}`} className="text-sm font-semibold">
              {section.title}
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {section.description}
            </p>
          </div>
          {section.body}
        </section>
      ))}
    </div>
  );
}
