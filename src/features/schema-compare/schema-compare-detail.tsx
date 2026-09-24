import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type DefinitionDiffApi,
  DefinitionDiffEditor,
  type DiffStats,
} from "@/features/compare/definition-diff-editor";
import { detailText } from "@/lib/schema-compare/diff";
import { type CompareResult, OBJECT_TYPE_META, STATUS_LABEL } from "@/lib/schema-compare/types";
import { SchemaObjectIcon } from "./schema-object-icon";

export function SchemaCompareDetail({
  result,
  activeKey,
}: {
  result: CompareResult;
  activeKey: string | null;
}) {
  const item = result.items.find((entry) => entry.key === activeKey) ?? null;
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [stats, setStats] = useState<DiffStats>({ changes: 0, added: 0, removed: 0 });
  const diffRef = useRef<DefinitionDiffApi>(null);
  const texts = useMemo(
    () =>
      item
        ? {
            source: detailText(item, "source", result.items),
            target: detailText(item, "target", result.items),
          }
        : { source: "", target: "" },
    [item, result.items],
  );

  if (!item)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        Objekt in der Liste wählen, um Quelle und Ziel nebeneinander zu sehen.
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <SchemaObjectIcon type={item.type} />
        <span className="text-muted-foreground">{OBJECT_TYPE_META[item.type].label}</span>
        <span className="truncate font-mono font-medium">
          {item.parent && item.parent !== item.name ? `${item.parent}.` : ""}
          {item.name}
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {STATUS_LABEL[item.status]}
        </Badge>
        {item.differsBy.length > 0 && (
          <span className="truncate text-muted-foreground">{item.differsBy.join(", ")}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Label className="flex items-center gap-1.5 text-xs font-normal">
            <Switch checked={onlyDifferences} onCheckedChange={setOnlyDifferences} />
            Nur Unterschiede
          </Label>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Vorherige Änderung"
            disabled={stats.changes === 0}
            onClick={() => diffRef.current?.goToChange(-1)}
          >
            <ChevronUpIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Nächste Änderung"
            disabled={stats.changes === 0}
            onClick={() => diffRef.current?.goToChange(1)}
          >
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
        <span className="truncate">Quelle: {result.sourceLabel}</span>
        <span className="truncate">Ziel: {result.targetLabel}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <DefinitionDiffEditor
          ref={diffRef}
          original={texts.source}
          modified={texts.target}
          onlyDifferences={onlyDifferences}
          onStats={setStats}
          readOnly
        />
      </div>
    </div>
  );
}
