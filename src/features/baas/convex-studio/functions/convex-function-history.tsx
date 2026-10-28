import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConvexFunctionHistory } from "./convex-function-history-store";

export function ConvexFunctionHistory({
  deploymentKey,
  identifier,
  componentPath,
  onPick,
}: {
  deploymentKey: string;
  identifier: string;
  componentPath: string | null;
  onPick: (args: string) => void;
}) {
  const runs = useConvexFunctionHistory((state) => state.runs[deploymentKey]);
  const clear = useConvexFunctionHistory((state) => state.clear);
  const [confirm, setConfirm] = useState(false);
  const [onlyThis, setOnlyThis] = useState(true);
  const all = runs ?? [];
  const visible = onlyThis
    ? all.filter((run) => run.identifier === identifier && run.componentPath === componentPath)
    : all;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">
          Verlauf ({visible.length}
          {onlyThis ? ` von ${all.length}` : ""}, maximal 50 pro Deployment)
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOnlyThis(!onlyThis)}>
            {onlyThis ? "Alle Funktionen" : "Nur diese Funktion"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={all.length === 0}
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="size-3.5" />
            Leeren
          </Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch keine Ausführungen.</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-auto rounded-lg border">
          {visible.map((run) => (
            <li key={run.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <Badge variant={run.success ? "secondary" : "destructive"}>
                {run.success ? "OK" : "Fehler"}
              </Badge>
              <span className="shrink-0 text-muted-foreground">
                {new Date(run.at).toLocaleString("de-DE")}
              </span>
              <span className="shrink-0 font-mono">{run.identifier}</span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
                title={run.preview}
              >
                {run.preview}
              </span>
              <span className="shrink-0 text-muted-foreground">{run.durationMs} ms</span>
              {run.identifier === identifier && run.componentPath === componentPath && (
                <Button size="xs" variant="outline" onClick={() => onPick(run.args)}>
                  Argumente übernehmen
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verlauf leeren?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle {all.length} gespeicherten Ausführungen dieses Deployments werden entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => clear(deploymentKey)}>Leeren</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
