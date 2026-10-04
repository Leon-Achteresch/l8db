import { useId } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { awsEnvConnections } from "@/lib/automation/aws-env";
import { fieldIssue } from "@/lib/automation/validation";
import { useConnectionsStore } from "@/lib/connections";
import type { MissedRunPolicy, Task, TaskSummary, ValidationIssue } from "@/lib/db/automation";
import { ChipsInput } from "./chips-input";
import { FormRow } from "./form-row";
import { FormSection } from "./form-section";
import { RetryFields } from "./retry-fields";
import { optionalNumber } from "./step-form-context";
import { SwitchRow } from "./switch-row";

interface Props {
  task: Task;
  tasks: TaskSummary[];
  issues: ValidationIssue[];
  onChange: (patch: Partial<Task>) => void;
}

const MISSED: { value: MissedRunPolicy; label: string }[] = [
  { value: "skip", label: "Auslassen" },
  { value: "run_once", label: "Einmal nachholen" },
];

export function TaskGeneralTab({ task, tasks, issues, onChange }: Props) {
  const foldersId = useId();
  const connections = useConnectionsStore((state) => state.connections);
  const awsEnv = task.background ? awsEnvConnections(task.steps, connections) : [];
  const folders = [...new Set(tasks.map((entry) => entry.task.folder).filter(Boolean))].sort();
  const error = (field: string) => fieldIssue(issues, null, field);
  const retention = task.retention ?? { keepDays: null, keepRuns: null };
  const setRetention = (patch: Partial<typeof retention>) => {
    const next = { ...retention, ...patch };
    onChange({ retention: next.keepDays === null && next.keepRuns === null ? null : next });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-5 pt-5 pb-16">
      <FormSection title="Beschreibung">
        <FormRow
          label="Wofür ist dieser Task?"
          hint="Markdown erlaubt. Erscheint in der Liste und im Verlauf."
        >
          <Textarea
            value={task.description}
            rows={3}
            placeholder="z. B. Exportiert jeden Morgen die Bestellungen des Vortags für die Buchhaltung."
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </FormRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Ordner" hint="Mit / verschachteln, z. B. Berichte/Monat.">
            <Input
              list={foldersId}
              value={task.folder}
              placeholder="Ohne Ordner"
              onChange={(event) => onChange({ folder: event.target.value })}
            />
          </FormRow>
          <datalist id={foldersId}>
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <FormRow label="Tags">
            <ChipsInput
              value={task.tags}
              onChange={(tags) => onChange({ tags })}
              itemLabel="Tag"
              placeholder="Tag, Enter"
            />
          </FormRow>
        </div>
      </FormSection>

      <FormSection
        title="Ausführung"
        description="Grenzen und Wiederholungen für den ganzen Task. Schritte können eigene Werte haben."
      >
        <FormRow
          label="Höchstdauer"
          error={error("timeoutSeconds")}
          hint="Sekunden. Danach wird der Lauf abgebrochen. Leer = unbegrenzt."
          className="max-w-56"
        >
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="unbegrenzt"
            value={task.timeoutSeconds ?? ""}
            onChange={(event) => onChange({ timeoutSeconds: optionalNumber(event.target.value) })}
          />
        </FormRow>
        <FormRow
          label="Wiederholen bei Fehler"
          hint="Gilt für jeden Schritt ohne eigene Einstellung."
          bind={false}
        >
          <RetryFields
            value={task.retry}
            onChange={(retry) => onChange({ retry })}
            offLabel="Nicht wiederholen"
          />
        </FormRow>
        <FormRow
          label="Automatisch pausieren nach"
          error={error("maxConsecutiveFailures")}
          hint="Fehlschlägen in Folge. Schützt vor einem Task, der jede Minute scheitert. Leer = nie."
          className="max-w-72"
        >
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="nie"
            value={task.maxConsecutiveFailures ?? ""}
            onChange={(event) =>
              onChange({ maxConsecutiveFailures: optionalNumber(event.target.value) })
            }
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Zeitplan-Verhalten"
        description="Was passiert, wenn ein Termin verpasst wurde, weil der Rechner aus war."
      >
        <div className="max-w-sm">
          <SegmentedControl
            label="Verpasste Läufe"
            value={task.missedRuns}
            options={MISSED}
            onChange={(missedRuns) => onChange({ missedRuns })}
          />
        </div>
        <SwitchRow
          label="Auch im Hintergrund ausführen"
          description="Läuft zu seinen Zeiten, auch wenn l8db geschlossen ist. Der Hintergrunddienst wird in den Automatisierungs-Einstellungen eingerichtet."
          checked={task.background}
          onCheckedChange={(background) => onChange({ background })}
        />
        {awsEnv.length > 0 && (
          <p
            data-testid="automation-aws-env-hint"
            className="ml-11 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-pretty text-amber-800 dark:text-amber-300"
          >
            Im Hintergrund stehen Umgebungsvariablen der Shell nicht zur Verfügung. Nutze ein
            AWS-Profil für {awsEnv.map((name) => `„${name}“`).join(", ")}.
          </p>
        )}
      </FormSection>

      <FormSection
        title="Verlauf aufbewahren"
        description="Leer = Standard aus den Automatisierungs-Einstellungen."
      >
        <div className="flex flex-wrap gap-4">
          <FormRow label="Tage" className="w-40">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Standard"
              value={retention.keepDays ?? ""}
              onChange={(event) => setRetention({ keepDays: optionalNumber(event.target.value) })}
            />
          </FormRow>
          <FormRow label="Läufe" className="w-40">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Standard"
              value={retention.keepRuns ?? ""}
              onChange={(event) => setRetention({ keepRuns: optionalNumber(event.target.value) })}
            />
          </FormRow>
        </div>
      </FormSection>
    </div>
  );
}
