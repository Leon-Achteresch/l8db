import { Fragment } from "react";
import {
  filterConditionText,
  filterOperatorSymbol,
  filterValueText,
} from "@/lib/filter-bar-format";
import { FilterConditionPopover } from "./filter-condition-popover";
import { FilterJoinToggle } from "./filter-join-toggle";
import { FilterToken } from "./filter-token";
import type { FilterBarModel } from "./use-filter-bar-model";

export function FilterConditionTokens({
  model,
  variant,
  afterRemove,
}: {
  model: FilterBarModel;
  variant: "chip" | "pill";
  afterRemove?: () => void;
}) {
  if (model.rawFilter)
    return (
      <FilterToken
        kind="condition"
        variant="chip"
        column={model.rawFilter}
        title={`Als ${model.sqlLabel} gesetzter Filter: ${model.rawFilter} – klicken zum Bearbeiten im ${model.sqlLabel}-Modus`}
        removeLabel="Filter entfernen"
        onOpen={() => model.switchMode("sql")}
        onRemove={() => {
          model.clearFilters();
          afterRemove?.();
        }}
      />
    );
  return model.conditions.map((condition, index) => {
    const text = filterConditionText(condition);
    const remove = () => {
      model.removeCondition(condition.id);
      afterRemove?.();
    };
    return (
      <Fragment key={condition.id}>
        {index > 0 ? (
          <FilterJoinToggle
            combinator={model.combinator}
            enabled={model.orSupported}
            onToggle={() => model.setJoin(model.combinator === "AND" ? "OR" : "AND")}
          />
        ) : null}
        <FilterConditionPopover
          condition={condition}
          columns={model.columns}
          columnDetails={model.columnDetails}
          title="Filter bearbeiten"
          onSave={(next) => {
            model.updateCondition(condition.id, next);
            return "";
          }}
          onRemove={remove}
        >
          {(open) => (
            <FilterToken
              kind="condition"
              variant={variant}
              column={condition.column}
              operator={filterOperatorSymbol(condition.operator)}
              value={filterValueText(condition)}
              title={`Filter: ${text} – klicken zum Bearbeiten`}
              removeLabel={`Filter entfernen: ${text}`}
              onOpen={open}
              onRemove={remove}
            />
          )}
        </FilterConditionPopover>
      </Fragment>
    );
  });
}
