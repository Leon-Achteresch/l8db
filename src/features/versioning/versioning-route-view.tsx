import { GitPullRequestIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useVersioningPanel } from "@/lib/versioning/panel";

export function VersioningRouteView() {
  const setOpen = useVersioningPanel((state) => state.setOpen);
  const setMode = useVersioningPanel((state) => state.setMode);
  const setTabHost = useVersioningPanel((state) => state.setTabHost);
  const open = useVersioningPanel((state) => state.open);
  const mode = useVersioningPanel((state) => state.mode);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTabHost(host.current);
    setMode("tab");
    setOpen(true);
    return () => setTabHost(null);
  }, [setOpen, setMode, setTabHost]);
  return (
    <div className="relative h-full min-h-0">
      <div ref={host} className="h-full min-h-0" hidden={mode !== "tab" || !open} />
      {(!open || mode !== "tab") && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <GitPullRequestIcon className="size-7 text-muted-foreground/50" strokeWidth={1.4} />
          <h1 className="text-sm font-medium">Versionierung</h1>
          <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
            Branches, Migrationen, Kundenstände und Development-Seeds.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode("tab");
              setOpen(true);
            }}
          >
            Versionierung öffnen
          </Button>
        </div>
      )}
    </div>
  );
}
