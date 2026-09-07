import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useState } from "react";

import { PlanComparisonPanel } from "@/features/explain/plan-comparison-panel";
import { type LoadedPlan, SavedPlanPanel } from "@/features/explain/saved-plan-panel";
import { parseExplainPlanFile } from "@/lib/explain-file";

const PLAN_FILTERS = [{ name: "l8db-Plan", extensions: ["json"] }];

type Slot = "a" | "b";

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function SavedPlanView() {
  const [plans, setPlans] = useState<Record<Slot, LoadedPlan | null>>({ a: null, b: null });
  const [errors, setErrors] = useState<Record<Slot, string | null>>({ a: null, b: null });
  const [busy, setBusy] = useState(false);

  const openPlan = useCallback(async (slot: Slot) => {
    setBusy(true);
    try {
      const path = await open({ multiple: false, directory: false, filters: PLAN_FILTERS });
      if (typeof path !== "string") return;
      try {
        const text = await readTextFile(path);
        const data = parseExplainPlanFile(text);
        setPlans((current) => ({
          ...current,
          [slot]: { path, fileName: fileNameOf(path), data },
        }));
        setErrors((current) => ({ ...current, [slot]: null }));
      } catch (error) {
        setPlans((current) => ({ ...current, [slot]: null }));
        setErrors((current) => ({
          ...current,
          [slot]: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const clearPlan = useCallback((slot: Slot) => {
    setPlans((current) => ({ ...current, [slot]: null }));
    setErrors((current) => ({ ...current, [slot]: null }));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h1 className="text-sm font-semibold">Gespeicherte Ausführungspläne</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Öffnet mit l8db gespeicherte Plandateien ohne Datenbankverbindung. Es wird kein SQL
          ausgeführt. Zwei geladene Pläne werden automatisch verglichen.
        </p>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <SavedPlanPanel
          label="Plan A"
          loaded={plans.a}
          error={errors.a}
          busy={busy}
          onOpen={() => void openPlan("a")}
          onClear={() => clearPlan("a")}
        />
        <SavedPlanPanel
          label="Plan B (Vergleich)"
          loaded={plans.b}
          error={errors.b}
          busy={busy}
          onOpen={() => void openPlan("b")}
          onClear={() => clearPlan("b")}
        />
      </div>

      {plans.a && plans.b && (
        <PlanComparisonPanel
          left={plans.a.data}
          right={plans.b.data}
          leftLabel={`A · ${plans.a.fileName}`}
          rightLabel={`B · ${plans.b.fileName}`}
        />
      )}
    </div>
  );
}
