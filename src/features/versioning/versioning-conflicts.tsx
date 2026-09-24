import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasMergeMarkers, mergeConflicts, resolveMergeConflict } from "@/lib/versioning/conflicts";

export function VersioningConflicts({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  if (!hasMergeMarkers(content)) return null;
  const conflicts = mergeConflicts(content);
  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <div className="flex items-start gap-2 text-xs">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">
            {conflicts.length
              ? `${conflicts.length} Merge-Konflikt${conflicts.length === 1 ? "" : "e"}`
              : "Ungelöste Merge-Konflikte"}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Wähle je Konflikt eine Fassung oder bearbeite den Text im Editor. Speichern und
            Committen dieser Datei sind erst nach dem Entfernen aller Konfliktmarker möglich.
          </p>
        </div>
      </div>
      {conflicts.map((conflict, index) => (
        <div key={conflict.start} className="space-y-2 rounded-md border bg-background/80 p-2.5">
          <p className="text-[11px] font-medium">Konflikt {index + 1}</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">Aktueller Branch</p>
              <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
                {conflict.current || "(leer)"}
              </pre>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">Quell-Branch</p>
              <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
                {conflict.incoming || "(leer)"}
              </pre>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange(resolveMergeConflict(content, conflict, "current"))}
            >
              Aktuellen behalten
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange(resolveMergeConflict(content, conflict, "incoming"))}
            >
              Quelle übernehmen
            </Button>
          </div>
        </div>
      ))}
      {!conflicts.length && (
        <p className="text-[11px] text-muted-foreground">
          Die Konfliktmarker sind unvollständig. Bitte manuell im Editor entfernen.
        </p>
      )}
    </div>
  );
}
