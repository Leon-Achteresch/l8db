import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FeatureVideoCard } from "@/features/updates/feature-video-card";
import type { FeatureVideo } from "@/lib/feature-videos/model";
import poster from "./feature-video-preview.jpg";

const item: FeatureVideo = {
  id: "dev-easy-mode",
  revision: "1",
  title: "Mehr Ruhe mit Easy Mode",
  summary: "Verbindungen, Tabellen und SQL im Fokus. Blende aus, was du gerade nicht brauchst.",
  releaseVersion: "Demo",
  minAppVersion: "0.0.0",
  sourceCommit: "dev-preview",
  publishedAt: "2026-09-23T00:00:00.000Z",
  expiresAt: "2026-12-22T00:00:00.000Z",
  priority: 90,
  platforms: [],
  requiredCapabilities: [],
  modes: [],
  actionId: "settings",
  durationSeconds: 12,
  poster,
  sources: [],
};

export function FeatureVideoPreview() {
  const [visible, setVisible] = useState(true);
  const [revision, setRevision] = useState(0);

  return (
    <section className="space-y-5">
      <div className="max-w-xl space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Neue Features, kurz gezeigt.</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Das Popup erscheint unten rechts mit einem Beispielbild. Probiere die kompakte und
          vergrößerte Ansicht aus oder schließe es über das Kreuz.
        </p>
        <p className="text-xs text-muted-foreground">
          Statische Bildvorschau · Im Release startet hier das Video automatisch und stumm.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          setRevision((value) => value + 1);
          setVisible(true);
        }}
      >
        {visible ? "Popup neu anzeigen" : "Popup öffnen"}
      </Button>
      {visible && (
        <FeatureVideoCard
          key={revision}
          item={item}
          suspended={false}
          next={undefined}
          preview={{ onClose: () => setVisible(false) }}
        />
      )}
    </section>
  );
}
