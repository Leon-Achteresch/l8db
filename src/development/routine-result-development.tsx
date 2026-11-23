import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProcedureRunDialog } from "@/features/functions/procedure-run-dialog";
import type { ProcedureExecution } from "@/features/functions/use-procedure-run";
import { callRoutineResultFixture } from "@/lib/db/routine-result-development";

const executions = {
  fast: { kind: "postgres", execute: () => callRoutineResultFixture("fast") },
  slow: { kind: "postgres", execute: () => callRoutineResultFixture("slow") },
} satisfies Record<string, ProcedureExecution>;

export function RoutineResultDevelopment() {
  const [open, setOpen] = useState(false);
  const [routine, setRoutine] = useState<keyof typeof executions>("fast");
  useEffect(() => {
    const switchRoutine = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.code !== "KeyF" || event.repeat) return;
      event.preventDefault();
      setRoutine((previous) => (previous === "fast" ? "slow" : "fast"));
    };
    window.addEventListener("keydown", switchRoutine);
    return () => window.removeEventListener("keydown", switchRoutine);
  }, []);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6 text-sm">
      <h1 className="text-lg font-semibold">Isolierte Routinenprüfung</h1>
      <p>Alt + Umschalt + F wechselt die Fixture-Routine auch bei offenem Dialog.</p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setRoutine("fast");
            setOpen(true);
          }}
        >
          Schnelle Routine öffnen
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setRoutine("slow");
            setOpen(true);
          }}
        >
          Langsame Routine öffnen
        </Button>
      </div>
      <ProcedureRunDialog
        open={open}
        onOpenChange={setOpen}
        schema="a16"
        name={routine}
        identityArgs="OUT details text, OUT missing text, OUT completed bigint"
        execution={executions[routine]}
      />
    </main>
  );
}
