import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ParsedFilter, parseFilterExpression } from "@/lib/filter-parser";
import type { FilterKind } from "@/lib/sql-filter";

export function FilterExpressionInput({
  columns,
  kind,
  onImport,
}: {
  columns: string[];
  kind?: FilterKind;
  onImport: (filter: ParsedFilter) => void;
}) {
  const [expression, setExpression] = useState("");
  const [error, setError] = useState("");
  const importExpression = () => {
    try {
      onImport(parseFilterExpression(expression, columns, kind));
      setExpression("");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Filterausdruck konnte nicht gelesen werden.",
      );
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Filterausdruck"
          aria-invalid={Boolean(error)}
          value={expression}
          onChange={(event) => {
            setExpression(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && expression.trim()) {
              event.preventDefault();
              importExpression();
            }
          }}
          placeholder={"Filterausdruck einfügen, z. B. \"STATUS\" = 'ANG'"}
          className="h-8 min-w-0 flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!expression.trim()}
          onClick={importExpression}
        >
          Ausdruck übernehmen
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Vergleiche, IN, NOT IN, IS NULL und AND/OR. Zusätzliche äußere Anführungszeichen werden
          entfernt.
        </p>
      )}
    </div>
  );
}
