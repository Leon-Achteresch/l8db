import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BlogSuggestionCard } from "@/features/updates/blog-suggestion-card";
import type { BlogPost } from "@/lib/blog-suggestions/model";
import image from "./feature-video-preview.jpg";

const post: BlogPost = {
  slug: "dev-ruhige-abfragen",
  url: "https://l8db.leon-achteresch.de/blog/dev-ruhige-abfragen",
  title: "Fünf Wege zu ruhigeren SQL-Abfragen",
  summary:
    "Wie Transaktionen, Zeilenlimits und der Explain-Plan dir helfen, auch auf Produktionsdatenbanken entspannt zu bleiben.",
  publishedAt: "2026-10-20",
  readingMinutes: 6,
  image,
  imageAlt: "Ein Abfrageplan in l8db",
  tags: ["sql"],
  suggest: { until: "2026-12-31", priority: 10, minAppVersion: null },
};

export function BlogSuggestionPreview() {
  const [visible, setVisible] = useState(true);
  const [withImage, setWithImage] = useState(true);
  const [revision, setRevision] = useState(0);
  const reopen = (value: boolean) => {
    setWithImage(value);
    setRevision((current) => current + 1);
    setVisible(true);
  };

  return (
    <section className="space-y-5">
      <div className="max-w-xl space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Ab und zu ein Artikel.</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Erscheint unten rechts, wenn gerade nichts los ist: höchstens alle drei Tage und jeder
          Artikel nur einmal. Feature-Videos haben Vorrang.
        </p>
        <p className="text-xs text-muted-foreground">
          Vorschau ohne automatisches Ausblenden · „Lesen“ öffnet hier keinen Browser.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => reopen(true)}>
          Mit Bild
        </Button>
        <Button variant="outline" onClick={() => reopen(false)}>
          Ohne Bild
        </Button>
      </div>
      {visible && (
        <BlogSuggestionCard
          key={revision}
          post={withImage ? post : { ...post, image: null, imageAlt: null }}
          suspended={false}
          onDismiss={() => setVisible(false)}
          onRead={() => setVisible(false)}
        />
      )}
    </section>
  );
}
