import { CheckIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { CsvImportState } from "./csv-import-panel/use-csv-import";

export function ImportSteps({ csv }: { csv: CsvImportState }) {
  const source = Boolean(csv.parsed) && !csv.fileError;
  const mapped =
    source &&
    Boolean(csv.targetTable) &&
    csv.mappings.some((mapping) => mapping.target) &&
    (csv.issues?.errors.length ?? 1) === 0;
  const finished = Boolean(csv.outcome && !csv.outcome.error);
  const steps = [
    { id: "source", label: "Quelle", done: source },
    { id: "mapping", label: "Zuordnung", done: mapped },
    { id: "options", label: "Optionen", done: mapped && !csv.blocked },
    { id: "run", label: "Ausführen", done: finished },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <ol className="flex min-w-0 items-center gap-2 text-xs" aria-label="Importschritte">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && <li aria-hidden className="h-px w-6 shrink-0 bg-border" />}
          <li>
            <button
              type="button"
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted",
                index === current ? "font-medium text-foreground" : "text-muted-foreground",
              )}
              onClick={() =>
                document
                  .getElementById(`import-step-${step.id}`)
                  ?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
            >
              <span
                className={cn(
                  "flex size-4.5 items-center justify-center rounded-full border text-[10px] tabular-nums",
                  step.done && "border-primary/40 bg-primary/15 text-primary",
                  index === current && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {step.done ? <CheckIcon className="size-3" /> : index + 1}
              </span>
              {step.label}
            </button>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
