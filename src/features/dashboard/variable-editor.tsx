import { CalendarIcon, CopyIcon, HashIcon, ListIcon, Trash2Icon, TypeIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createId,
  type DashboardVariable,
  type VariableType,
  variableName,
  variableToken,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { VariableControl } from "./variable-control";

const TYPES: { type: VariableType; label: string; Icon: typeof TypeIcon; example: string }[] = [
  { type: "select", label: "Auswahl", Icon: ListIcon, example: "Mandant, Lagerbereich" },
  { type: "text", label: "Text", Icon: TypeIcon, example: "Artikelnummer" },
  { type: "number", label: "Zahl", Icon: HashIcon, example: "MHD < X Tage" },
  { type: "date", label: "Datum", Icon: CalendarIcon, example: "Stichtag" },
];

export function VariableEditor({
  variable,
  taken,
  onSave,
  onDelete,
  onDone,
}: {
  variable: DashboardVariable | null;
  taken: string[];
  onSave: (variable: DashboardVariable) => void;
  onDelete?: () => void;
  onDone: () => void;
}) {
  const labelId = useId();
  const [label, setLabel] = useState(variable?.label ?? "");
  const [type, setType] = useState<VariableType>(variable?.type ?? "select");
  const [defaultValue, setDefaultValue] = useState(variable?.defaultValue ?? "");
  const [source, setSource] = useState<"list" | "sql">(variable?.optionsSql ? "sql" : "list");
  const [list, setList] = useState((variable?.options ?? []).join("\n"));
  const [sql, setSql] = useState(variable?.optionsSql ?? "");
  const base = variable?.name ?? variableName(label || "filter");
  let name = base;
  for (let i = 2; !variable && taken.includes(name); i++) name = `${base}_${i}`;
  const draft: DashboardVariable = {
    id: variable?.id ?? createId(),
    name,
    label: label.trim() || "Filter",
    type,
    defaultValue,
    ...(type === "select" && source === "list"
      ? {
          options: list
            .split(/\n|,/)
            .map((v) => v.trim())
            .filter(Boolean),
        }
      : {}),
    ...(type === "select" && source === "sql" && sql.trim() ? { optionsSql: sql.trim() } : {}),
  };

  return (
    <div className="space-y-4">
      <label htmlFor={labelId} className="block space-y-1 text-xs font-medium">
        <span>Name des Filters</span>
        <Input
          id={labelId}
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="z. B. Mandant"
          className="h-8 text-xs"
        />
      </label>
      <fieldset className="grid grid-cols-4 gap-1.5">
        <legend className="mb-1.5 text-xs font-medium">Art</legend>
        {TYPES.map(({ type: t, label: text, Icon, example }) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            title={example}
            onClick={() => setType(t)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              type === t && "border-primary bg-primary/5 text-primary",
            )}
          >
            <Icon className="size-4" />
            {text}
          </button>
        ))}
      </fieldset>
      {type === "select" && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            <Button
              size="xs"
              variant={source === "list" ? "secondary" : "ghost"}
              onClick={() => setSource("list")}
            >
              Feste Werte
            </Button>
            <Button
              size="xs"
              variant={source === "sql" ? "secondary" : "ghost"}
              onClick={() => setSource("sql")}
            >
              Werte aus Abfrage
            </Button>
          </div>
          {source === "list" ? (
            <textarea
              aria-label="Auswahlwerte"
              value={list}
              onChange={(e) => setList(e.target.value)}
              rows={3}
              placeholder={"Mandant A\nMandant B"}
              className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <textarea
              aria-label="Abfrage für Auswahlwerte"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="SELECT DISTINCT mandant FROM bestand ORDER BY 1"
              className="w-full rounded-lg border bg-background px-2.5 py-1.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium">Startwert</p>
        <div className="rounded-lg border px-1">
          <VariableControl variable={draft} value={defaultValue} onChange={setDefaultValue} />
        </div>
      </div>
      <div className="space-y-1.5 rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
        <p>
          Koppel den Filter im Chart unter{" "}
          <span className="font-medium text-foreground">Filter</span> oder nutze ihn in SQL:
        </p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(variableToken(name));
            toast.success("Platzhalter kopiert");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-foreground hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {variableToken(name)} <CopyIcon className="size-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 border-t pt-3">
        {onDelete && (
          <Button variant="ghost" size="xs" className="text-destructive" onClick={onDelete}>
            <Trash2Icon /> Entfernen
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSave(draft);
              onDone();
            }}
          >
            {variable ? "Übernehmen" : "Filter anlegen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
