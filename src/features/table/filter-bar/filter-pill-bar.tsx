import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterAiPopover } from "./filter-ai-popover";
import { FilterConditionPopover } from "./filter-condition-popover";
import { FilterConditionTokens } from "./filter-condition-tokens";
import { FilterModeToggle } from "./filter-mode-toggle";
import { FilterRuleTokens } from "./filter-rule-tokens";
import { FilterSqlField } from "./filter-sql-field";
import { useFilterAi } from "./use-filter-ai";
import { type FilterBarProps, useFilterBarModel } from "./use-filter-bar-model";

export function FilterPillBar(props: FilterBarProps) {
  const model = useFilterBarModel(props);
  const ai = useFilterAi(model);
  const simple = model.mode === "simple";
  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-2">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        <FilterModeToggle mode={model.mode} sqlLabel={model.sqlLabel} onChange={model.switchMode} />
        {simple ? (
          <>
            <FilterConditionTokens model={model} variant="pill" />
            <FilterConditionPopover
              columns={model.columns}
              columnDetails={model.columnDetails}
              title="Neuer Filter"
              onSave={(condition) => model.addConditions([condition])}
            >
              {(open) => (
                <Button
                  type="button"
                  variant="outline"
                  size={model.conditions.length ? "icon-xs" : "xs"}
                  className="shrink-0 border-dashed text-muted-foreground"
                  aria-label="Filter hinzufügen"
                  title="Filter hinzufügen"
                  onClick={() => open("column")}
                >
                  <PlusIcon />
                  {model.conditions.length ? null : "Filter"}
                </Button>
              )}
            </FilterConditionPopover>
          </>
        ) : (
          <div className="flex h-7 min-w-48 flex-1 items-center rounded-md border border-input bg-background/60 pl-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <FilterSqlField
              value={model.sql}
              json={model.json}
              columns={model.columns}
              label={model.sqlLabel}
              dirty={model.sqlDirty}
              onChange={(value) => {
                model.setSql(value);
                model.setError("");
              }}
              onSubmit={() => model.applySql(model.sql)}
            />
          </div>
        )}
        <FilterRuleTokens model={model} variant="pill" showLabel={!model.rules.length} />
        <span className="flex-1" />
        {model.hasFilter ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            aria-label="Alle Filter entfernen"
            title="Alle Filter entfernen"
            onClick={model.clearFilters}
          >
            <XIcon />
          </Button>
        ) : null}
        <FilterAiPopover ai={ai} model={model} />
      </div>
      {model.error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {model.error}
        </p>
      ) : null}
    </div>
  );
}
