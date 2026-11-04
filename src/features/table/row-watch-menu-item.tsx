import { EyeIcon } from "lucide-react";
import { useContext } from "react";
import { IconMenuItem } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";

export function RowWatchMenuItem() {
  const { scope, records, states, setOpen } = useContext(RowWatchContext);
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.rows.watch");
  if (!scope) return null;
  const changed = states.filter((state) => state.changed.length > 0).length;
  return (
    <IconMenuItem
      ref={feature.ref}
      icon={<EyeIcon />}
      label={`Beobachtete Zeilen (${records.length})${changed ? ` · ${changed} geändert` : ""}`}
      onSelect={() => setOpen(true)}
    >
      {feature.isNew ? (
        <NewBadge className="absolute -right-1 -top-1" />
      ) : changed > 0 ? (
        <span className="absolute right-0 top-0 size-1.5 rounded-full bg-primary" />
      ) : null}
    </IconMenuItem>
  );
}
