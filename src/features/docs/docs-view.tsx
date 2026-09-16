import { useSearch } from "@tanstack/react-router";
import { ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { docsUrl } from "@/lib/docs";

export function DocsView() {
  const { path } = useSearch({ from: "/docs" });
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const url = docsUrl(path ?? "");

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setFailed(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);

  const reload = () => {
    setFailed(false);
    setLoading(true);
    if (frameRef.current) frameRef.current.src = url;
  };

  return (
    <main className="workspace-canvas flex h-full w-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/80 px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Dokumentation</p>
          <p className="truncate text-xs text-muted-foreground">{url}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={reload}>
            <RotateCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            <span>Neu laden</span>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              <span>Im Browser</span>
            </a>
          </Button>
        </div>
      </div>
      {failed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium">Dokumentation nicht erreichbar</p>
          <p className="max-w-[48ch] text-xs text-muted-foreground">
            {url} lädt nicht. Entweder ist die Seite offline, oder die Adresse ist in der
            frame-src-Regel der App nicht freigegeben.
          </p>
          <div className="flex items-center gap-2">
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
        title="l8db Dokumentation"
        className={failed ? "hidden" : "min-h-0 w-full flex-1 border-0 bg-background"}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        onLoad={() => {
          setLoading(false);
          setFailed(false);
        }}
      />
    </main>
  );
}
