import { Link } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft, ExternalLink, RotateCw, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { DiagnosticsDialog } from "@/features/about/diagnostics-dialog";
import { websiteUrl } from "@/lib/website";

export function AboutView() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const url = websiteUrl();

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setFailed(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);

  const reload = () => {
    setFailed(false);
    setLoading(true);
    if (frameRef.current) {
      frameRef.current.src = url;
    }
  };

  return (
    <main className="workspace-canvas flex h-full w-full min-w-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to="/connections">
              <ArrowLeft className="size-4" />
              <span className="sr-only">Zurück zu Verbindungen</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2.5 min-w-0">
            <AppLogo className="size-6 shadow-sm ring-1 ring-border" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold tracking-tight">Über l8db</p>
                {appVersion ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    v{appVersion}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{url}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiagnosticsOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <Wrench className="size-3.5" />
            <span>Diagnose</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={reload} className="h-8 gap-1.5 text-xs">
            <RotateCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            <span>Neu laden</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              <span>Im Browser</span>
            </a>
          </Button>
        </div>
      </div>

      {failed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium">Website nicht erreichbar</p>
          <p className="max-w-[48ch] text-xs text-muted-foreground">
            {url} konnte nicht geladen werden. Prüfe deine Internetverbindung oder öffne die Seite
            direkt im Browser.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={reload}>
              <RotateCw className="size-3.5" />
              <span>Erneut versuchen</span>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                <span>Im Browser öffnen</span>
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      <iframe
        ref={frameRef}
        src={url}
        title="l8db Website"
        className={failed ? "hidden" : "min-h-0 w-full flex-1 border-0 bg-background"}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        onLoad={() => {
          setLoading(false);
          setFailed(false);
        }}
      />

      <DiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
    </main>
  );
}
