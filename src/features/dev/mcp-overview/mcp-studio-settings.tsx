import { X } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import type { LabDatabase, LabLimits } from "./data";
import { McpStudioChips } from "./mcp-studio-chips";
import { McpStudioToggle } from "./mcp-studio-toggle";

interface McpStudioSettingsProps {
  database: LabDatabase | null;
  limits: LabLimits;
  workflows: boolean;
  maskRules: number;
  onDatabase: (patch: Partial<LabDatabase>) => void;
  onLimits: (patch: Partial<LabLimits>) => void;
  onWorkflows: (value: boolean) => void;
  onClose: () => void;
}

const LIMITS: { key: keyof LabLimits; label: string; unit: string }[] = [
  { key: "maxRows", label: "Zeilen", unit: "" },
  { key: "maxCellChars", label: "Zeichen/Zelle", unit: "" },
  { key: "maxChars", label: "Zeichen/Antwort", unit: "" },
  { key: "queryTimeout", label: "Timeout", unit: "s" },
];

export function McpStudioSettings({
  database,
  limits,
  workflows,
  maskRules,
  onDatabase,
  onLimits,
  onWorkflows,
  onClose,
}: McpStudioSettingsProps) {
  if (!database) {
    return (
      <div className="space-y-5">
        <h3 className="text-sm font-semibold">Für alle Datenbanken</h3>
        <div className="grid grid-cols-2 gap-2">
          {LIMITS.map(({ key, label, unit }) => (
            <label key={key} className="rounded-xl bg-muted/50 px-3 py-2.5">
              <span className="block text-[11px] text-muted-foreground">{label}</span>
              <span className="flex items-baseline gap-1">
                <input
                  type="number"
                  min={1}
                  value={limits[key]}
                  onChange={(event) => onLimits({ [key]: Number(event.target.value) })}
                  className="w-full bg-transparent font-mono text-base tabular-nums outline-none"
                />
                {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <McpStudioToggle label="Workflows steuern" checked={workflows} onChange={onWorkflows} />
          <div className="flex items-center justify-between px-1 py-1.5 text-sm">
            <span>Maskierungsregeln</span>
            <span className="font-mono text-muted-foreground tabular-nums">{maskRules}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Datenbank wählen für eigene Rechte.</p>
      </div>
    );
  }
  const production = database.environment === "production";
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ProviderLogo kind={database.kind} className="size-5" />
        <h3 className="flex-1 truncate text-sm font-semibold">{database.name}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Auswahl aufheben"
          className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className={cn("space-y-1", !database.exposed && "pointer-events-none opacity-40")}>
        <McpStudioToggle
          label="Nur Lesen"
          checked={database.readOnly}
          onChange={(readOnly) =>
            onDatabase(
              readOnly ? { readOnly, allowDdl: false, allowProductionWrites: false } : { readOnly },
            )
          }
        />
        <McpStudioToggle
          label="DDL erlauben"
          checked={database.allowDdl}
          disabled={database.readOnly}
          onChange={(allowDdl) => onDatabase({ allowDdl })}
        />
        <McpStudioToggle
          label="Skripte"
          checked={database.allowScripts}
          onChange={(allowScripts) => onDatabase({ allowScripts })}
        />
        {production && (
          <McpStudioToggle
            label="Produktion beschreiben"
            tone="warn"
            checked={database.allowProductionWrites}
            disabled={database.readOnly}
            onChange={(allowProductionWrites) => onDatabase({ allowProductionWrites })}
          />
        )}
      </div>
      <McpStudioChips
        label="Schemas"
        values={database.schemas}
        placeholder="weiteres Schema"
        empty="alle Schemas"
        onChange={(schemas) => onDatabase({ schemas })}
      />
      <McpStudioChips
        label="Spaltenmaskierung"
        values={database.maskedColumns}
        placeholder="Spalte oder Muster"
        empty="z. B. passwort, iban, geheim.*"
        accent
        onChange={(maskedColumns) => onDatabase({ maskedColumns })}
      />
    </div>
  );
}
