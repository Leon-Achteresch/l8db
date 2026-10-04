import { CheckCircle2Icon, CircleAlertIcon, PlugZapIcon, VariableIcon } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { providerFor } from "@/lib/connection-url";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { type ConnectionCheck, testAutomationConnection } from "@/lib/db/automation";
import { capabilitiesFor } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { useStepForm } from "./step-form-context";

export type ConnectionCapability =
  | "backup"
  | "csv_import"
  | "table_copy"
  | "data_compare"
  | "full_table_export";

const CAPABILITY_MESSAGE: Record<ConnectionCapability, string> = {
  backup: "Backup wird für diesen Datenbanktyp nicht unterstützt.",
  csv_import: "Import wird für diesen Datenbanktyp nicht unterstützt.",
  table_copy: "Tabellenkopie wird für diesen Datenbanktyp nicht unterstützt.",
  data_compare: "Datenvergleich wird für diesen Datenbanktyp nicht unterstützt.",
  full_table_export: "Tabellenexport wird für diesen Datenbanktyp nicht unterstützt.",
};

export function unsupportedReason(
  connection: SavedConnection,
  capability?: ConnectionCapability,
): string | null {
  if (connection.temporary) return "Temporäre Verbindungen erst speichern.";
  if (connection.vault)
    return "Verbindungen aus dem Passwortmanager können nicht unbeaufsichtigt laufen, weil ihr Passwort nur während der Sitzung vorliegt.";
  if (connection.kind === "s3")
    return "Objektspeicher-Verbindungen unterstützen keine Automatisierungsschritte.";
  if (capability && !capabilitiesFor(connection.kind)[capability])
    return CAPABILITY_MESSAGE[capability];
  return null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  capability?: ConnectionCapability;
  label?: string;
  testable?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

const EMPTY = "__none__";

export function ConnectionPicker({
  value,
  onChange,
  capability,
  label = "Verbindung",
  testable = true,
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: Props) {
  const { task, items } = useStepForm();
  const connections = useConnectionsStore((state) => state.connections);
  const [check, setCheck] = useState<ConnectionCheck | { ok: false; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const lower = value.toLowerCase();
  const selected =
    connections.find((entry) => entry.id === value) ??
    connections.find((entry) => entry.name.toLowerCase() === lower) ??
    null;
  const variables = [
    ...items,
    ...task.variables
      .filter((variable) => variable.kind === "text" || variable.kind === "choice")
      .map((variable) => variable.name),
  ];
  const isVariable = value.includes("${");
  const unknown = Boolean(value) && !selected && !isVariable;
  const reason = selected ? unsupportedReason(selected, capability) : null;

  const runCheck = async () => {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await testAutomationConnection(value));
    } catch (error) {
      setCheck({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 gap-1.5">
        <Select
          value={selected?.id ?? (value || EMPTY)}
          onValueChange={(next) => {
            setCheck(null);
            onChange(next === EMPTY ? "" : next);
          }}
        >
          <SelectTrigger
            id={id}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="h-[calc(2.25rem+var(--ui-density-step))] min-w-0 flex-1 rounded-lg"
          >
            <SelectValue placeholder="Verbindung wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            <SelectItem value={EMPTY} className="text-muted-foreground">
              Keine
            </SelectItem>
            {unknown && (
              <SelectItem value={value}>
                <CircleAlertIcon className="size-3.5 text-amber-600" />„{value}“ (nicht gefunden)
              </SelectItem>
            )}
            <SelectGroup>
              <SelectLabel>Gespeicherte Verbindungen</SelectLabel>
              {connections.map((entry) => {
                const why = unsupportedReason(entry, capability);
                return (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={Boolean(why)}
                    title={why ?? undefined}
                  >
                    <ProviderLogo
                      providerId={providerFor(entry).id}
                      kind={entry.kind}
                      className="size-3.5"
                    />
                    <span className="truncate">{entry.name}</span>
                    {why && <span className="sr-only">– {why}</span>}
                  </SelectItem>
                );
              })}
            </SelectGroup>
            {variables.length > 0 && (
              <SelectGroup>
                <SelectLabel>Aus Variable</SelectLabel>
                {variables.map((name) => (
                  <SelectItem key={name} value={`\${${name}}`}>
                    <VariableIcon className="size-3.5 text-violet-500" />
                    <span className="font-mono text-xs">{`\${${name}}`}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {testable && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!value || isVariable || checking || Boolean(reason)}
            onClick={() => void runCheck()}
            aria-label="Verbindung prüfen"
            title="Verbindung prüfen"
          >
            {checking ? <Spinner className="size-4" /> : <PlugZapIcon />}
          </Button>
        )}
      </div>
      {reason && <p className="text-xs text-pretty text-destructive">{reason}</p>}
      {check && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 text-xs text-pretty",
            check.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {check.ok ? (
            <CheckCircle2Icon className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {check.ok && "via" in check
            ? `Verbunden (${check.via}). ${check.message}`.trim()
            : check.message}
        </p>
      )}
    </div>
  );
}
