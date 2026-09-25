import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import "./notebook-book.css";

type Flip = { dir: "next" | "prev"; from: number };

export function NotebookBook({
  pages,
  target,
}: {
  pages: ReactNode[];
  target: { index: number } | null;
}) {
  const spreads = Math.max(1, Math.ceil(pages.length / 2));
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState<Flip | null>(null);
  const current = Math.min(spread, spreads - 1);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(spreads - 1, next));
    if (clamped === current || flip) return;
    setFlip({ dir: clamped > current ? "next" : "prev", from: current });
    setSpread(clamped);
  };

  const [handled, setHandled] = useState<{ index: number } | null>(null);
  useEffect(() => {
    if (!target || target === handled || flip) return;
    setHandled(target);
    go(Math.floor(target.index / 2));
  }, [target, handled, flip]);

  const leftIndex = flip?.dir === "next" ? flip.from * 2 : current * 2;
  const rightIndex = flip?.dir === "prev" ? flip.from * 2 + 1 : current * 2 + 1;
  const pageNumber = (index: number) => (index < pages.length ? index + 1 : null);

  const page = (index: number, side: "left" | "right") => (
    <div
      className={cn(
        "nb-paper relative flex min-h-0 flex-1 flex-col overflow-auto px-8 pt-11 pb-10",
        side === "left" ? "nb-page-left" : "nb-page-right",
      )}
    >
      {pages[index]}
      {pageNumber(index) !== null && (
        <span
          className={cn(
            "pointer-events-none sticky top-full mt-auto self-end pt-4 font-mono text-[10px] text-muted-foreground",
            side === "left" && "self-start",
          )}
        >
          {pageNumber(index)}
        </span>
      )}
    </div>
  );

  return (
    <div
      className="nb-book flex h-full min-h-0 flex-col items-center gap-3 px-6 py-5"
      onKeyDown={(event) => {
        if (!event.altKey) return;
        if (event.key === "ArrowRight") go(current + 1);
        if (event.key === "ArrowLeft") go(current - 1);
      }}
    >
      <div className="nb-cover relative flex min-h-0 w-full max-w-[1400px] flex-1 rounded-lg p-2.5 pr-5">
        <div className="relative flex min-h-0 flex-1">
          {page(leftIndex, "left")}
          <div className="w-px shrink-0 bg-black/20" />
          {page(rightIndex, "right")}
          {flip && (
            <div
              key={`${flip.from}-${current}`}
              className="nb-leaf"
              data-dir={flip.dir}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) setFlip(null);
              }}
            >
              <div
                className={cn(
                  "nb-leaf-face nb-paper",
                  flip.dir === "next" ? "nb-page-right" : "nb-page-left",
                )}
              />
              <div
                className={cn(
                  "nb-leaf-face nb-leaf-back nb-paper",
                  flip.dir === "next" ? "nb-page-left" : "nb-page-right",
                )}
              />
            </div>
          )}
          {current > 0 && (
            <button
              type="button"
              aria-label="Zurückblättern"
              className="nb-corner nb-corner-left absolute bottom-0 left-0 z-10 size-7 rounded-bl-md"
              onClick={() => go(current - 1)}
            />
          )}
          {current < spreads - 1 && (
            <button
              type="button"
              aria-label="Umblättern"
              className="nb-corner absolute right-0 bottom-0 z-10 size-7 rounded-br-md"
              onClick={() => go(current + 1)}
            />
          )}
        </div>
        <div className="pointer-events-none absolute top-0 right-1 bottom-0 w-3 bg-black/85 shadow-[inset_1px_0_0_rgb(255_255_255/0.08)]" />
        <div className="pointer-events-none absolute -bottom-6 left-1/2 h-10 w-2 -translate-x-1/2 bg-black/85 [clip-path:polygon(0_0,100%_0,100%_100%,50%_82%,0_100%)]" />
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-3 text-xs text-muted-foreground">
        <IconButton
          variant="ghost"
          size="icon-xs"
          aria-label="Vorherige Doppelseite"
          disabled={current === 0}
          onClick={() => go(current - 1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <span className="tabular-nums">
          Doppelseite {current + 1} / {spreads}
        </span>
        <IconButton
          variant="ghost"
          size="icon-xs"
          aria-label="Nächste Doppelseite"
          disabled={current === spreads - 1}
          onClick={() => go(current + 1)}
        >
          <ChevronRightIcon />
        </IconButton>
      </div>
    </div>
  );
}
