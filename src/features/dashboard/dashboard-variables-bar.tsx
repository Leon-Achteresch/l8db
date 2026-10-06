import { FilterIcon, PlusIcon, RotateCcwIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type DashboardVariable, useVariableValuesStore } from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { VariableControl } from "./variable-control";
import { VariableEditor } from "./variable-editor";

export function DashboardVariablesBar({
  dashboardId,
  variables,
  editing,
  onChange,
}: {
  dashboardId: string;
  variables: DashboardVariable[];
  editing: boolean;
  onChange: (variables: DashboardVariable[]) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("dashboard.filters");
  const values = useVariableValuesStore((s) => s.values[dashboardId]);
  const setValue = useVariableValuesStore((s) => s.set);
  const reset = useVariableValuesStore((s) => s.reset);
  const [open, setOpen] = useState<string | null>(null);
  if (!editing && variables.length === 0) return null;
  const changed = variables.some(
    (v) => values?.[v.name] !== undefined && values[v.name] !== v.defaultValue,
  );
  const save = (variable: DashboardVariable) =>
    onChange(
      variables.some((v) => v.id === variable.id)
        ? variables.map((v) => (v.id === variable.id ? variable : v))
        : [...variables, variable],
    );
  return (
    <div
      ref={feature.ref}
      role="toolbar"
      aria-label="Dashboard-Filter"
      className="flex flex-wrap items-center gap-2"
    >
      <FilterIcon className="size-3.5 text-muted-foreground" />
      {variables.map((variable) => {
        const value = values?.[variable.name] ?? variable.defaultValue;
        return (
          <div
            key={variable.id}
            className={cn(
              "flex h-8 items-center gap-1 rounded-full border bg-card pr-1 pl-3 shadow-xs transition-colors",
              value && "border-primary/40 bg-primary/5",
            )}
          >
            <span className="text-[11px] text-muted-foreground">{variable.label}</span>
            <VariableControl
              variable={variable}
              value={value}
              onChange={(next) => setValue(dashboardId, variable.name, next)}
            />
            {editing && (
              <Popover
                open={open === variable.id}
                onOpenChange={(o) => setOpen(o ? variable.id : null)}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Filter ${variable.label} bearbeiten`}
                    className="rounded-full"
                  >
                    <Settings2Icon />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="start">
                  <VariableEditor
                    variable={variable}
                    taken={variables.map((v) => v.name)}
                    onSave={save}
                    onDelete={() => {
                      onChange(variables.filter((v) => v.id !== variable.id));
                      setOpen(null);
                    }}
                    onDone={() => setOpen(null)}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        );
      })}
      {editing && (
        <Popover open={open === "new"} onOpenChange={(o) => setOpen(o ? "new" : null)}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="rounded-full border border-dashed">
              <PlusIcon /> Filter hinzufügen
              {feature.isNew && <NewBadge />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <VariableEditor
              variable={null}
              taken={variables.map((v) => v.name)}
              onSave={save}
              onDone={() => setOpen(null)}
            />
          </PopoverContent>
        </Popover>
      )}
      {changed && (
        <Button variant="ghost" size="xs" onClick={() => reset(dashboardId)}>
          <RotateCcwIcon /> Zurücksetzen
        </Button>
      )}
    </div>
  );
}
