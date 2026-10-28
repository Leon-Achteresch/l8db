import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { renameCandidates } from "@/lib/schema-compare/diff";
import { toggleRename, useSchemaCompareStore } from "@/lib/schema-compare/store";
import type { CompareResult, DiffItem } from "@/lib/schema-compare/types";

export function SchemaCompareRenameBar({
  result,
  item,
}: {
  result: CompareResult;
  item: DiffItem;
}) {
  const renames = useSchemaCompareStore((state) => state.renames);
  const feature = useNewFeatureVisibility<HTMLDivElement>("schema-compare.rename-column");
  const candidates = renameCandidates(result.items, item);
  if (candidates.length === 0) return null;

  return (
    <div
      ref={feature.ref}
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-muted/20 px-3 py-1.5 text-xs"
    >
      <span className="text-muted-foreground">Umbenennen statt Löschen und Anlegen:</span>
      {candidates.map((other) => {
        const [added, dropped] = item.status === "only_source" ? [item, other] : [other, item];
        const active = renames[added.key] === dropped.key;
        return (
          <Button
            key={other.key}
            size="sm"
            variant={active ? "secondary" : "outline"}
            className="h-6 px-2 font-mono text-xs"
            aria-pressed={active}
            title={
              active
                ? "Wieder löschen und neu anlegen"
                : `${dropped.name} umbenennen, statt die Spalte samt Daten zu löschen`
            }
            onClick={() => toggleRename(added.key, dropped.key, !active)}
          >
            {dropped.name} → {added.name}
          </Button>
        );
      })}
      {feature.isNew && <NewBadge />}
    </div>
  );
}
