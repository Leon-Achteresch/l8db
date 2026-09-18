import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SimpleDataset, SortMode } from "@/lib/dashboards";

export function ChartSortLimitSection({
  s,
  patchSimple,
}: {
  s: SimpleDataset;
  patchSimple: (patch: Partial<SimpleDataset>) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">4 · Reihenfolge und Höchstzahl</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={s.sort} onValueChange={(sort) => patchSimple({ sort: sort as SortMode })}>
          <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Sortierung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dimension">Aufteilung A→Z / alt→neu</SelectItem>
            <SelectItem value="metric_desc">Größte Werte zuerst</SelectItem>
            <SelectItem value="metric_asc">Kleinste Werte zuerst</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={String(s.limit)}
          onValueChange={(limit) => patchSimple({ limit: Number(limit) })}
        >
          <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Höchstzahl an Gruppen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100, 500].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Höchstens {n} Gruppen
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
