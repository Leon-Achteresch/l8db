import { useMemo } from "react";
import { type JsonPath, jsonKind, previewValue, tableShape } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { JsonTypeIcon } from "./json-type-icon";

type Props = {
  value: unknown;
  basePath: JsonPath;
  onPick: (path: JsonPath) => void;
};

const KIND_TEXT: Record<string, string> = {
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-blue-600 tabular-nums dark:text-blue-300 text-right",
  boolean: "text-amber-600 dark:text-amber-300",
  null: "italic text-muted-foreground",
  object: "text-muted-foreground",
  array: "text-muted-foreground",
};

export function JsonTableView({ value, basePath, onPick }: Props) {
  const shape = useMemo(() => tableShape(value), [value]);
  if (!shape) return null;
  return (
    <div className="h-full overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-popover">
          <tr>
            <th className="border-b border-border px-2 py-1.5 text-right font-medium text-muted-foreground">
              #
            </th>
            {shape.columns.map((column) => (
              <th
                key={column}
                className="border-b border-l border-border px-2 py-1.5 text-left font-semibold"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shape.rows.map((row, index) => (
            <tr key={index} className="hover:bg-muted/50">
              <td className="border-b border-border/60 px-2 py-1 text-right text-muted-foreground tabular-nums">
                {index}
              </td>
              {shape.columns.map((column) => {
                const has = Object.hasOwn(row, column);
                const cell = row[column];
                const kind = jsonKind(cell);
                return (
                  <td
                    key={column}
                    onClick={() => has && onPick([...basePath, index, column])}
                    className={cn(
                      "max-w-72 cursor-pointer truncate border-b border-l border-border/60 px-2 py-1",
                      has ? KIND_TEXT[kind] : "bg-muted/30",
                    )}
                    title={has ? previewValue(cell, 400) : "fehlt"}
                  >
                    {has &&
                      (kind === "object" || kind === "array" ? (
                        <span className="inline-flex items-center gap-1">
                          <JsonTypeIcon kind={kind} />
                          {previewValue(cell, 40)}
                        </span>
                      ) : kind === "string" ? (
                        (cell as string)
                      ) : (
                        String(cell)
                      ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
