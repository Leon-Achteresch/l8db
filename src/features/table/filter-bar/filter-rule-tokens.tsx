import { PaletteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  filterConditionsText,
  filterOperatorSymbol,
  filterValueText,
} from "@/lib/filter-bar-format";
import { nextRuleColor, ruleColorLabel } from "@/lib/row-rules";
import { FilterToken } from "./filter-token";
import { RuleEditorPopover } from "./rule-editor-popover";
import type { FilterBarModel } from "./use-filter-bar-model";

export function FilterRuleTokens({
  model,
  variant,
  showLabel,
}: {
  model: FilterBarModel;
  variant: "chip" | "pill";
  showLabel: boolean;
}) {
  return (
    <>
      {model.rules.length ? (
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      ) : null}
      {model.rules.map((rule) => {
        const label = filterConditionsText(rule.conditions, rule.combinator);
        const single =
          variant === "pill" && rule.conditions.length === 1 ? rule.conditions[0] : null;
        const remove = () => model.removeRule(rule.id);
        return (
          <RuleEditorPopover
            key={rule.id}
            rule={rule}
            columns={model.columns}
            columnDetails={model.columnDetails}
            orSupported={model.orSupported}
            defaultColor={rule.color}
            onSave={model.updateRule}
            onRemove={remove}
          >
            {(open) => (
              <FilterToken
                kind="rule"
                variant={single ? "pill" : "chip"}
                column={single ? single.column : label}
                operator={single ? filterOperatorSymbol(single.operator) : undefined}
                value={single ? filterValueText(single) : undefined}
                color={rule.color}
                title={`Farbregel (${ruleColorLabel(rule.color)}): ${label} – klicken zum Bearbeiten`}
                removeLabel={`Farbregel entfernen: ${label}`}
                onOpen={open}
                onRemove={remove}
              />
            )}
          </RuleEditorPopover>
        );
      })}
      <RuleEditorPopover
        columns={model.columns}
        columnDetails={model.columnDetails}
        orSupported={model.orSupported}
        defaultColor={nextRuleColor(model.rules)}
        onSave={model.addRule}
      >
        {(open) => (
          <Button
            type="button"
            variant="ghost"
            size={showLabel ? "xs" : "icon-xs"}
            className="shrink-0 text-muted-foreground"
            aria-label="Farbregel hinzufügen"
            title="Passende Zeilen farbig markieren"
            onClick={open}
          >
            <PaletteIcon />
            {showLabel ? "Farbe" : null}
          </Button>
        )}
      </RuleEditorPopover>
    </>
  );
}
