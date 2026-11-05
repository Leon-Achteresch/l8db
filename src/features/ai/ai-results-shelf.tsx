import { ChartColumn } from "lucide-react";
import type { AiFigureBlock } from "@/lib/ai/result";
import { cn } from "@/lib/utils";
import { AiResultCard } from "./ai-result-card";

export function AiResultsShelf({
  figures,
  className,
}: {
  figures: AiFigureBlock[];
  className?: string;
}) {
  return (
    <section
      aria-label="Ergebnisse"
      className={cn("min-h-0 flex-1 overflow-auto px-4 pt-2 pb-6", className)}
    >
      {figures.length ? (
        <div className="space-y-4">
          {figures.map((block) => (
            <AiResultCard key={block.id} block={block} inShelf />
          ))}
        </div>
      ) : (
        <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <ChartColumn className="size-4" />
          </span>
          <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
            Diagramme und Tabellen aus dem Gespräch landen hier.
          </p>
        </div>
      )}
    </section>
  );
}
