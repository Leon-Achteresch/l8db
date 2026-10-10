import { ArrowDownIcon, ArrowUpIcon, DiffIcon, EllipsisIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { IconMenu, IconMenuCheckboxItem, IconMenuContent } from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DefinitionDiffApi,
  DefinitionDiffEditor,
  type DiffStats,
} from "@/features/compare/definition-diff-editor";
import { detailText } from "@/lib/schema-compare/diff";
import { type CompareResult, OBJECT_TYPE_META, STATUS_LABEL } from "@/lib/schema-compare/types";
import { SchemaObjectIcon } from "./schema-object-icon";
import { StatusMarker } from "./status-marker";

export function SchemaCompareDetail({
  result,
  activeKey,
}: {
  result: CompareResult;
  activeKey: string | null;
}) {
  const item = result.items.find((entry) => entry.key === activeKey) ?? null;
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [layout, setLayout] = useState<"inline" | "side">("inline");
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
        Objekt in der Liste wählen.
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/30 pr-1.5 pl-3 text-xs">
        <SchemaObjectIcon type={item.type} />
        <span className="truncate font-mono font-medium">
          {item.parent && item.parent !== item.name ? `${item.parent}.` : ""}
          {item.name}
        </span>
        {item.status === "identical" ? (
          <span className="text-muted-foreground">{STATUS_LABEL.identical}</span>
        ) : (
          <StatusMarker status={item.status} />
        )}
        <span className="truncate text-muted-foreground">
          {OBJECT_TYPE_META[item.type].label}
          {stats.changes > 0 &&
            ` · ${stats.changes} ${stats.changes === 1 ? "Änderung" : "Änderungen"}`}
          {item.differsBy.length > 0 && ` · ${item.differsBy.join(", ")}`}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={layout}
            onValueChange={(value) => value && setLayout(value as "inline" | "side")}
            aria-label="Diff-Darstellung"
          >
            <ToggleGroupItem value="inline" className="h-6 px-2 text-xs">
              Inline
            </ToggleGroupItem>
            <ToggleGroupItem value="side" className="h-6 px-2 text-xs">
              Nebeneinander
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Vorherige Änderung"
            title="Vorherige Änderung"
            disabled={stats.changes === 0}
            onClick={() => diffRef.current?.goToChange(-1)}
          >
            <ArrowUpIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Nächste Änderung"
            title="Nächste Änderung"
            disabled={stats.changes === 0}
            onClick={() => diffRef.current?.goToChange(1)}
          >
            <ArrowDownIcon className="size-3.5" />
          </Button>
          <IconMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Diff-Optionen"
                title="Diff-Optionen"
              >
                <EllipsisIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent>
              <IconMenuCheckboxItem
                icon={<DiffIcon />}
                label="Nur Unterschiede"
                checked={onlyDifferences}
                onCheckedChange={(checked) => setOnlyDifferences(checked === true)}
              />
            </IconMenuContent>
          </IconMenu>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <DefinitionDiffEditor
          ref={diffRef}
          original={texts.source}
          modified={texts.target}
          onlyDifferences={onlyDifferences}
          onStats={setStats}
          sideBySide={layout === "side"}
          readOnly
        />
      </div>
    </div>
  );
}
