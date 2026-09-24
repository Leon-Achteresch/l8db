import { ArrowLeftRightIcon, GitCompareIcon, InfoIcon, LoaderIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import {
  databaseFromConnectionString,
  useActiveDatabase,
  useActiveSchema,
} from "@/lib/db-selection";
import { useSchemasQuery } from "@/lib/queries";
import {
  activeTypes,
  connectionFor,
  runSchemaCompare,
  setupProblem,
  useSchemaCompareStore,
} from "@/lib/schema-compare/store";
import {
  compareTypesFor,
  OBJECT_TYPE_META,
  type SchemaCompareOptions,
} from "@/lib/schema-compare/types";
import { SchemaCompareSidePicker } from "./schema-compare-side-picker";
import { SchemaObjectIcon } from "./schema-object-icon";

const OPTION_LABELS: { key: keyof SchemaCompareOptions; label: string; hint: string }[] = [
  {
    key: "ignoreWhitespace",
    label: "Leerzeichen und Zeilenumbrüche ignorieren",
    hint: "Formatierungsunterschiede im Quelltext gelten nicht als Änderung.",
  },
  {
    key: "ignoreCase",
    label: "Groß-/Kleinschreibung ignorieren",
    hint: "Vergleicht Quelltext ohne Beachtung der Schreibweise.",
  },
  {
    key: "ignoreSystemNames",
    label: "Systemgenerierte Namen ignorieren",
    hint: "Constraints und Indizes wie SYS_C… werden über ihre Definition zugeordnet.",
  },
  {
    key: "ignoreSequenceValues",
    label: "Aktuelle Sequenzwerte ignorieren",
    hint: "Nur Inkrement, Grenzen, Cache und Zyklus werden verglichen.",
  },
];

export function SchemaCompareSetup({ onStarted }: { onStarted?: () => void }) {
  const state = useSchemaCompareStore();
  const set = useSchemaCompareStore.setState;
  const kind = connectionFor(state.source)?.kind ?? connectionFor(state.target)?.kind;
  const supported = compareTypesFor(kind);
  const selected = activeTypes(state, kind);
  const problem = setupProblem(state.source, state.target, selected);
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const activeReady = useSchemasQuery().isSuccess;

  useEffect(() => {
    if (!active || !activeReady || compareTypesFor(active.kind).length === 0) return;
    if (useSchemaCompareStore.getState().source.connectionId) return;
    set({
      source: {
        connectionId: active.id,
        database: activeDatabase ?? databaseFromConnectionString(active.connectionString),
        schema: activeSchema,
      },
    });
  }, [active, activeReady, activeDatabase, activeSchema]);

  const toggleType = (type: (typeof supported)[number], checked: boolean) =>
    set({
      types: checked
        ? supported.filter((item) => item === type || selected.includes(item))
        : selected.filter((item) => item !== type),
    });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <SchemaCompareSidePicker
          title="Quelle"
          value={state.source}
          other={state.target}
          onChange={(source) => set({ source })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Quelle und Ziel tauschen"
          title="Quelle und Ziel tauschen"
          onClick={() => set({ source: state.target, target: state.source })}
        >
          <ArrowLeftRightIcon className="size-4" />
        </Button>
        <SchemaCompareSidePicker
          title="Ziel"
          value={state.target}
          other={state.source}
          onChange={(target) => set({ target })}
        />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Zu vergleichende Objekttypen</h3>
          <span className="text-xs text-muted-foreground">
            {selected.length} von {supported.length}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => set({ types: supported })}
            >
              Alle
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => set({ types: [] })}
            >
              Keine
            </Button>
          </div>
        </div>
        {supported.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
            Verbindung wählen. Der Schema-Vergleich steht für Oracle und PostgreSQL zur Verfügung.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl border p-3 sm:grid-cols-3">
            {supported.map((type) => (
              <Label
                key={type}
                className="flex cursor-pointer items-center gap-2 text-xs font-normal"
              >
                <Checkbox
                  checked={selected.includes(type)}
                  onCheckedChange={(checked) => toggleType(type, checked === true)}
                />
                <SchemaObjectIcon type={type} />
                {OBJECT_TYPE_META[type].plural}
                {type === "table" && <span className="text-muted-foreground">(inkl. Spalten)</span>}
              </Label>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Optionen</h3>
        <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
          {OPTION_LABELS.map((option) => (
            <Label
              key={option.key}
              className="flex cursor-pointer items-start gap-2 text-xs font-normal"
            >
              <Switch
                checked={state.options[option.key]}
                onCheckedChange={(checked) =>
                  set({ options: { ...state.options, [option.key]: checked } })
                }
              />
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-muted-foreground">{option.hint}</span>
              </span>
            </Label>
          ))}
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {problem && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <InfoIcon className="size-3.5 shrink-0" />
            {problem}
          </span>
        )}
        <Button
          disabled={Boolean(problem) || Boolean(state.loading)}
          onClick={() => {
            onStarted?.();
            void runSchemaCompare();
          }}
        >
          {state.loading ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <GitCompareIcon className="size-4" />
          )}
          {state.loading ?? "Vergleichen"}
        </Button>
      </div>
    </div>
  );
}
