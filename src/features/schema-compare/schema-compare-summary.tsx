import type { CatalogObjectType } from "@/lib/db";
import {
  type CompareResult,
  type DiffStatus,
  OBJECT_TYPE_META,
  STATUS_LABEL,
  TYPE_ORDER,
} from "@/lib/schema-compare/types";
import { SchemaObjectIcon } from "./schema-object-icon";

const COLUMNS: DiffStatus[] = ["only_source", "only_target", "different", "identical"];

export function SchemaCompareSummary({
  result,
  onPick,
}: {
  result: CompareResult;
  onPick: (type: CatalogObjectType, status: DiffStatus) => void;
}) {
  const counts = new Map<string, number>();
  for (const item of result.items) {
    const key = `${item.type}|${item.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const types = TYPE_ORDER.filter((type) =>
    COLUMNS.some((status) => counts.has(`${type}|${status}`)),
  );
  const total = (status: DiffStatus) =>
    result.items.filter((item) => item.status === status).length;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Objekttyp</th>
            {COLUMNS.map((status) => (
              <th key={status} className="px-3 py-1.5 text-right font-medium">
                {STATUS_LABEL[status]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type} className="border-b last:border-0">
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-1.5">
                  <SchemaObjectIcon type={type} />
                  {OBJECT_TYPE_META[type].plural}
                </span>
              </td>
              {COLUMNS.map((status) => {
                const count = counts.get(`${type}|${status}`) ?? 0;
                return (
                  <td key={status} className="px-3 py-1.5 text-right tabular-nums">
                    {count > 0 ? (
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => onPick(type, status)}
                      >
                        {count}
                      </button>
                    ) : (
                      <span className="text-muted-foreground/50">0</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="py-1.5 pr-3">Gesamt</td>
            {COLUMNS.map((status) => (
              <td key={status} className="px-3 py-1.5 text-right tabular-nums">
                {total(status)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
