import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabaseStudioDatabaseDefinition } from "@/lib/db/supabase-studio-database";

export interface DefinitionTarget {
  kind: "view" | "function";
  oid: number;
  title: string;
}

export function DatabaseDefinitionDialog({
  reference,
  target,
  onClose,
}: {
  reference: string;
  target: DefinitionTarget | null;
  onClose: () => void;
}) {
  const definition = useQuery({
    queryKey: ["supabase", reference, "studio-database", "definition", target?.kind, target?.oid],
    queryFn: () =>
      target ? supabaseStudioDatabaseDefinition(reference, target.kind, target.oid) : "",
    enabled: target !== null,
  });
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.title}</DialogTitle>
        </DialogHeader>
        {definition.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {String(definition.error)}
          </p>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {definition.data ?? "Wird geladen…"}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
