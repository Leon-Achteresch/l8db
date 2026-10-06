import { BracesIcon, Loader2Icon, PuzzleIcon, Settings2Icon } from "lucide-react";
import { IconMenuItem } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { useTableExtensionActions } from "@/lib/hooks/use-table-extension-actions";

const ICONS: Record<string, typeof PuzzleIcon> = {
  braces: BracesIcon,
  "settings-2": Settings2Icon,
};

export function TableExtensionActions({
  actions,
  running,
  run,
}: ReturnType<typeof useTableExtensionActions>) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.extensions.table-json-viewer");
  if (!actions.length) return null;

  return (
    <>
      {actions.map((action) => {
        const Icon = ICONS[action.icon ?? ""] ?? PuzzleIcon;
        const isViewer = action.id === "tablejson.show";
        return (
          <IconMenuItem
            key={action.id}
            ref={isViewer ? feature.ref : undefined}
            icon={running === action.id ? <Loader2Icon className="animate-spin" /> : <Icon />}
            label={action.title}
            disabled={running !== null}
            onSelect={() => void run(action.id, action.owner)}
          >
            {isViewer && feature.isNew && <NewBadge className="absolute -right-1 -top-1" />}
          </IconMenuItem>
        );
      })}
    </>
  );
}
