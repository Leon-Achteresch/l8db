import { lazy, Suspense, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { sqlDialectLabel } from "@/lib/sql-format-options";
import type { SqlFormatReview } from "./use-sql-format-review";

const DiffEditor = lazy(() =>
  import("@/features/compare/definition-diff-editor").then((module) => ({
    default: module.DefinitionDiffEditor,
  })),
);

export function SqlFormatReviewDialog({
  review,
  onClose,
  onApply,
  onRestoreFocus,
}: {
  review: SqlFormatReview;
  onClose: () => void;
  onApply: () => void;
  onRestoreFocus: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const compareId = useId();
  const [diffReady, setDiffReady] = useState(false);
  const highlight =
    review.status === "ready" &&
    review.original.length + review.formatted.length <= 48_000 &&
    [review.original, review.formatted].every((text) => text.split("\n", 300).length < 300);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-auto sm:max-w-5xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>SQL-Formatierung vergleichen</DialogTitle>
          <DialogDescription>
            Textvergleich · {sqlDialectLabel(review.dialect)} ·{" "}
            {review.selection ? "Auswahl" : "Gesamtes SQL"}
          </DialogDescription>
        </DialogHeader>
        {review.status === "loading" && (
          <p role="status" className="text-sm text-muted-foreground">
            SQL wird formatiert…
          </p>
        )}
        {review.status === "unchanged" && (
          <p role="status" className="text-sm text-muted-foreground">
            Der Text bleibt gleich.
          </p>
        )}
        {review.status === "stale" && (
          <p role="status" className="text-sm text-muted-foreground">
            Die Vorschau ist veraltet. Starte den Vergleich erneut.
          </p>
        )}
        {review.status === "error" && (
          <p role="alert" className="max-h-36 overflow-auto text-sm wrap-anywhere text-destructive">
            {review.message}
          </p>
        )}
        {review.status === "ready" && highlight && (
          <div className="min-w-0">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Original → Formatiert</p>
            <div
              className="h-[min(52dvh,32rem)] overflow-hidden rounded-md bg-muted/40"
              data-slot="sql-format-diff"
            >
              <Suspense
                fallback={
                  <p role="status" className="p-3 text-sm">
                    Vergleich wird geladen…
                  </p>
                }
              >
                <DiffEditor
                  original={review.original}
                  modified={review.formatted}
                  onlyDifferences={false}
                  ignoreTrimWhitespace={false}
                  maxComputationTime={120}
                  readOnly
                  onStats={() => setDiffReady(true)}
                />
              </Suspense>
            </div>
          </div>
        )}
        {review.status === "ready" && !highlight && (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2" data-slot="sql-format-diff">
            {[
              ["Original", review.original],
              ["Formatiert", review.formatted],
            ].map(([label, text], index) => (
              <label
                key={label}
                htmlFor={`${compareId}-${index}`}
                className="space-y-2 text-xs font-medium text-muted-foreground"
              >
                {label}
                <Textarea
                  id={`${compareId}-${index}`}
                  readOnly
                  value={text}
                  wrap="off"
                  spellCheck={false}
                  className="h-[min(22dvh,14rem)] field-sizing-fixed resize-none font-mono sm:h-[min(52dvh,32rem)]"
                />
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button ref={cancel} variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            onClick={onApply}
            disabled={review.status !== "ready" || (highlight && !diffReady)}
          >
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
