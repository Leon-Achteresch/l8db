import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import type { DatasetJoin, JoinKind, JoinPair } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { JoinColumnPick } from "./join-column-pick";
import { JoinMatchMeter } from "./join-match-meter";
import { JoinVenn } from "./join-venn";
import type { StudioNode } from "./studio-model";
import { useJoinStats } from "./use-join-stats";

const KINDS: { kind: JoinKind; title: string; text: (base: string, other: string) => string }[] = [
  {
    kind: "left",
    title: "Alle behalten",
    text: (base, other) => `Jede ${base}-Zeile bleibt, auch ohne passende ${other}-Zeile.`,
  },
  {
    kind: "inner",
    title: "Nur mit Treffer",
    text: (base, other) => `Nur ${base}-Zeilen, die eine passende ${other}-Zeile haben.`,
  },
];

function pairsOf(join: DatasetJoin): JoinPair[] {
  return [{ from: join.fromColumn, to: join.toColumn }, ...(join.extra ?? [])];
}

export function JoinEditor({
  node,
  parent,
  parentColumns,
  columns,
  onChange,
  onRemove,
}: {
  node: StudioNode & { join: DatasetJoin };
  parent: StudioNode;
  parentColumns: string[];
  columns: string[];
  onChange: (patch: Partial<DatasetJoin>) => void;
  onRemove: () => void;
}) {
  const join = node.join;
  const kind = join.kind ?? "left";
  const pairs = pairsOf(join);
  const setPairs = (next: JoinPair[]) => {
    const [first, ...extra] = next;
    onChange({ fromColumn: first.from, toColumn: first.to, extra });
  };
  const { stats, loading, error } = useJoinStats(parent, node, pairs);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">
          {parent.table} <span className="text-muted-foreground">verbunden mit</span> {node.table}
        </p>
      </div>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 text-xs font-medium">Welche Zeilen sollen bleiben?</legend>
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            aria-pressed={kind === option.kind}
            onClick={() => onChange({ kind: option.kind })}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
              kind === option.kind && "border-primary bg-primary/5 text-primary",
            )}
          >
            <JoinVenn kind={option.kind} className="h-5 w-8" />
            <span className="text-xs font-semibold">{option.title}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {option.text(parent.table, node.table)}
            </span>
          </button>
        ))}
      </fieldset>
      <div className="space-y-2">
        <p className="text-xs font-medium">Passend, wenn …</p>
        {pairs.map((pair, index) => (
          <div key={`${index}:${pair.from}:${pair.to}`} className="flex items-center gap-1.5">
            <JoinColumnPick
              value={pair.from}
              columns={parentColumns}
              label={`Spalte aus ${parent.table}`}
              onChange={(from) => setPairs(pairs.map((p, i) => (i === index ? { ...p, from } : p)))}
            />
            <span className="text-xs text-muted-foreground">=</span>
            <JoinColumnPick
              value={pair.to}
              columns={columns}
              label={`Spalte aus ${node.table}`}
              onChange={(to) => setPairs(pairs.map((p, i) => (i === index ? { ...p, to } : p)))}
            />
            {index > 0 ? (
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Bedingung entfernen"
                onClick={() => setPairs(pairs.filter((_, i) => i !== index))}
              >
                <XIcon />
              </IconButton>
            ) : (
              <span className="size-8 shrink-0" />
            )}
          </div>
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setPairs([...pairs, { from: "", to: "" }])}
        >
          <PlusIcon /> Weitere Bedingung, z. B. Mandant
        </Button>
      </div>
      <JoinMatchMeter stats={stats} loading={loading} error={error} baseLabel={parent.table} />
      <div className="flex justify-end border-t pt-3">
        <Button variant="ghost" size="xs" className="text-destructive" onClick={onRemove}>
          <Trash2Icon /> Verknüpfung entfernen
        </Button>
      </div>
    </div>
  );
}
