import { GitPullRequestIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useVersioningPanel } from "@/lib/versioning/panel";

export function VersioningRouteView() {
  const setOpen = useVersioningPanel((state) => state.setOpen);
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <GitPullRequestIcon className="size-7 text-muted-foreground/50" strokeWidth={1.4} />
      <h1 className="text-sm font-medium">Versionierung in der Seitenleiste</h1>
      <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
        Branches, Releases und Kundenstände bleiben neben deinem Arbeitsbereich erreichbar.
      </p>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Versionierung öffnen
      </Button>
    </div>
  );
}
