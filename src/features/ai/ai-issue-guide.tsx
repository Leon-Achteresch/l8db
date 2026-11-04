import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFeatureVideos } from "@/lib/feature-videos/use-feature-videos";

export function AiIssueGuide({ onClose }: { onClose: () => void }) {
  const { items } = useFeatureVideos();
  const clip = items.find((item) => item.id === "ai-issue-report");
  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    return () => {
      video.pause();
      video.removeAttribute("src");
      for (const source of video.querySelectorAll("source")) source.removeAttribute("src");
      video.load();
    };
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Aus einem Problem wird ein Issue</DialogTitle>
          <DialogDescription>
            Direkt aus deinem KI-Gespräch – mit Vorschau und deiner Freigabe.
          </DialogDescription>
        </DialogHeader>
        {clip && (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="none"
            poster={clip.poster}
            className="aspect-video w-full rounded-xl border bg-black"
            aria-label="Issues im KI-Chat: Erklärungsvideo"
          >
            {clip.sources.map((source) => (
              <source key={source.type} src={source.url} type={source.type} />
            ))}
            <track kind="captions" />
          </video>
        )}
        <ol className="list-decimal space-y-4 pl-5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Problem beschreiben.</strong> Schreibe „Erstelle
            dafür ein Issue“. Die KI fasst den Fehler und die Schritte aus dem Gespräch zusammen.
          </li>
          <li>
            <strong className="text-foreground">Vorschau prüfen.</strong> Öffne die Issue-Card.
            Diagnose und geschwärzter Screenshot sind im Modal sichtbar. Überprüfe alle Inhalte auf
            sensible Informationen.
          </li>
          <li>
            <strong className="text-foreground">Bewusst veröffentlichen.</strong> Erst „Öffentliches
            Issue erstellen“ sendet den Bericht. Die Card zeigt dir danach den GitHub-Link. Du
            brauchst kein GitHub-Konto.
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}
