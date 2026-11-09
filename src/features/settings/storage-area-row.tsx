import { Eye, PencilLine } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { StorageConfirmButton } from "@/features/settings/storage-confirm-button";
import { StorageEntryDialog } from "@/features/settings/storage-entry-dialog";
import { commitStorageAndReload } from "@/lib/app-storage";
import { formatBytes, PROTECTED_STORAGE_KEYS, type StorageArea } from "@/lib/storage-usage";

interface Props {
  area: StorageArea;
  value: string;
  maxBytes: number;
}

export function StorageAreaRow({ area, value, maxBytes }: Props) {
  const [open, setOpen] = useState(false);
  const locked = PROTECTED_STORAGE_KEYS.has(area.key);

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{area.label}</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">{area.key}</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/35"
            style={{ width: `${Math.max(1, (area.bytes / maxBytes) * 100)}%` }}
          />
        </div>
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatBytes(area.bytes)}
      </span>
      <div className="flex shrink-0 items-center">
        <IconButton
          aria-label={locked ? `${area.label} ansehen` : `${area.label} bearbeiten`}
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          {locked ? <Eye /> : <PencilLine />}
        </IconButton>
        {locked ? (
          <span className="size-[calc(1.5rem+var(--ui-density-step))]" />
        ) : (
          <StorageConfirmButton
            iconOnly
            label={`${area.label} löschen`}
            title={`${area.label} löschen?`}
            description="l8db lädt danach neu."
            confirm="Löschen"
            onConfirm={() => void commitStorageAndReload({ [area.key]: null })}
          />
        )}
      </div>
      {open ? (
        <StorageEntryDialog storageKey={area.key} value={value} onOpenChange={setOpen} />
      ) : null}
    </li>
  );
}
