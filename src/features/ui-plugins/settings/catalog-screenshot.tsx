import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadUiPluginScreenshot, type UiPluginCatalogEntry } from "@/lib/ui-plugins/catalog";

export function CatalogScreenshot({ entry }: { entry: UiPluginCatalogEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void downloadUiPluginScreenshot(entry)
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [entry]);
  if (!entry.screenshot) return null;
  return (
    <div className="aspect-[16/9] w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40">
      {url ? (
        <img
          src={url}
          alt={`Screenshot: ${entry.name}`}
          className="size-full object-cover object-top"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <ImageIcon className={failed ? "size-5 opacity-40" : "size-5 animate-pulse"} />
        </div>
      )}
    </div>
  );
}
