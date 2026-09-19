import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ExternalChangeBannerProps {
  fileDirty: boolean;
  fileBusy: boolean;
  onReload: () => void;
  onKeepLocal: () => void;
}

export function ExternalChangeBanner({
  fileDirty,
  fileBusy,
  onReload,
  onKeepLocal,
}: ExternalChangeBannerProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
      <AlertTriangleIcon className="size-3.5 text-amber-500" />
      <span className="min-w-0 flex-1 truncate">
        Datei wurde außerhalb von l8db geändert
        {fileDirty ? " – lokale Änderungen vorhanden" : ""}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={fileBusy}
        onClick={onReload}
      >
        {fileDirty ? "Neu laden (lokale Änderungen verwerfen)" : "Neu laden"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        disabled={fileBusy}
        onClick={onKeepLocal}
      >
        Lokale Fassung behalten
      </Button>
    </div>
  );
}
