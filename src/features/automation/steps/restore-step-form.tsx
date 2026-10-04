import { Input } from "@/components/ui/input";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { optionalNumber, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

export function RestoreStepForm({ action, onChange }: StepFormProps<"restore">) {
  const pathError = useFieldError("path");
  const options = action.options;
  const setOptions = (patch: Partial<typeof options>) =>
    onChange({ ...action, options: { ...options, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <ConnectionFields
        connection={action.connection}
        database={action.database}
        capability="backup"
        label="Ziel"
        onChange={(next) => onChange({ ...action, ...next })}
      />
      <FormRow label="Backup-Datei" error={pathError}>
        <PathInput
          mode="open"
          value={action.path}
          placeholder="${output_dir}/backups/app.dump"
          onChange={(path) => onChange({ ...action, path })}
        />
      </FormRow>
      <FormRow
        label="Parallele Jobs"
        hint="Leer = ein Job. Nur bei Formaten, die das können."
        className="max-w-48"
      >
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="1"
          value={options.jobs ?? ""}
          onChange={(event) => setOptions({ jobs: optionalNumber(event.target.value) })}
        />
      </FormRow>
      <div className="flex flex-col gap-3">
        <SwitchRow
          label="Vorhandene Objekte vorher entfernen"
          checked={Boolean(options.clean)}
          onCheckedChange={(clean) => setOptions({ clean })}
        />
        <SwitchRow
          label="Nur entfernen, was existiert"
          description="Fehlende Objekte beim Entfernen überspringen statt abzubrechen. Wirkt nur zusammen mit dem Schalter darüber."
          disabled={!options.clean}
          checked={Boolean(options.ifExists)}
          onCheckedChange={(ifExists) => setOptions({ ifExists })}
        />
        <SwitchRow
          label="Ohne Eigentümer"
          description="Besitzrechte aus dem Backup nicht übernehmen; Objekte gehören dem verbundenen Benutzer."
          checked={Boolean(options.noOwner)}
          onCheckedChange={(noOwner) => setOptions({ noOwner })}
        />
        <SwitchRow
          label="In einer Transaktion"
          description="Bei einem Fehler bleibt das Ziel unverändert, sofern die Datenbank das unterstützt."
          checked={Boolean(options.singleTransaction)}
          onCheckedChange={(singleTransaction) => setOptions({ singleTransaction })}
        />
        <SwitchRow
          label="Auch auf Produktion erlauben"
          description="Ohne diese Freigabe bricht der Schritt bei Verbindungen mit Umgebung „Produktion“ ab. Lesemodus-Verbindungen bleiben immer gesperrt."
          checked={action.allowProduction}
          onCheckedChange={(allowProduction) => onChange({ ...action, allowProduction })}
        />
      </div>
    </div>
  );
}
