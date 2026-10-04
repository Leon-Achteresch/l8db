import { EyeOffIcon, LockIcon, LockOpenIcon } from "lucide-react";
import { useState } from "react";
import { branchingUpdate, type ProtectionLevel } from "@/lib/db";
import { cn } from "@/lib/utils";
import { NameConfirmDialog } from "./name-confirm-dialog";
import type { BranchingWorkspace } from "./use-branching";

const LEVELS = [
  {
    value: null,
    icon: LockOpenIcon,
    label: "Offen",
    description: "Branches, Sicherungen und Wiederherstellungen ohne zusätzliche Hürden.",
  },
  {
    value: "protected",
    icon: LockIcon,
    label: "Geschützt",
    description:
      "Wiederherstellen nur mit Namensbestätigung und Änderungsgrund. Für Produktionsdatenbanken.",
  },
  {
    value: "masked",
    icon: EyeOffIcon,
    label: "Maskiert",
    description:
      "Zusätzlich nur anonymisierte oder Schema-Branches und keine lokalen Klartext-Sicherungen. Es gelten ausschließlich die Team-Regeln.",
  },
] as const;

const RANK = { none: 0, protected: 1, masked: 2 };

export function ProtectionSettings({ workspace }: { workspace: BranchingWorkspace }) {
  const [lowering, setLowering] = useState<ProtectionLevel | null | undefined>(undefined);
  const overview = workspace.overview;
  const root = overview?.databases.find((entry) => entry.name === overview.root);
  if (!overview || !root) return null;
  const current = root.marker?.protection ?? null;
  const owner = root.isOwner || overview.server.superuser;
  const editable = owner && !overview.readOnly && !workspace.busy;
  const apply = (protection: ProtectionLevel | null, confirm = "") =>
    void workspace.run(
      () =>
        branchingUpdate(workspace.url(), {
          action: "protection",
          database: root.name,
          protection,
          confirm,
        }),
      "Schutzstufe gespeichert.",
    );
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Schutzstufe" className="grid gap-2 sm:grid-cols-3">
        {LEVELS.map((level) => {
          const selected = current === level.value;
          return (
            <button
              key={level.label}
              type="button"
              aria-pressed={selected}
              disabled={!editable}
              onClick={() => {
                if (selected) return;
                if (RANK[level.value ?? "none"] < RANK[current ?? "none"]) setLowering(level.value);
                else apply(level.value);
              }}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                selected ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/40 hover:bg-muted/70",
              )}
            >
              <level.icon
                className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")}
                strokeWidth={1.7}
              />
              <span className="text-xs font-medium">{level.label}</span>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {level.description}
              </span>
            </button>
          );
        })}
      </div>
      {!owner && (
        <p className="text-[11px] text-muted-foreground">
          Nur der Eigentümer ({root.owner}) oder ein Superuser kann die Schutzstufe ändern.
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Die Schutzstufe ist eine Leitplanke für l8db, kein Ersatz für Datenbankrechte: Wer
        Eigentümer ist, kann sie auch per SQL ändern. Jede Änderung wird protokolliert.
      </p>
      {lowering !== undefined && (
        <NameConfirmDialog
          title="Schutzstufe verringern?"
          description={`„${root.name}“ wird auf „${LEVELS.find((level) => level.value === lowering)?.label}“ gesetzt. Damit entfallen Sicherheitsvorkehrungen für alle Nutzer.`}
          name={root.name}
          requireName
          action="Verringern"
          destructive
          onClose={() => setLowering(undefined)}
          onConfirm={(confirm) => apply(lowering, confirm)}
        />
      )}
    </div>
  );
}
