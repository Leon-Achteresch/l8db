import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  supabaseEdgeFunctionDownload,
  supabaseEdgeFunctionSource,
} from "@/lib/db/supabase-studio-edge";

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function SupabaseFunctionSource({ reference, slug }: { reference: string; slug: string }) {
  const source = useQuery({
    queryKey: ["supabase", reference, "function-source", slug],
    queryFn: () => supabaseEdgeFunctionSource(reference, slug),
    staleTime: 60_000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const download = useMutation({ mutationFn: () => supabaseEdgeFunctionDownload(reference, slug) });
  const files = source.data?.files ?? [];
  const file = files.find((item) => item.path === selected) ?? files[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          <Download className="size-3.5" />
          {download.isPending ? "Wird geladen…" : "In Ordner herunterladen"}
        </Button>
        {download.data && (
          <span className="text-xs text-muted-foreground">Gespeichert in {download.data}</span>
        )}
        {download.isError && (
          <span role="alert" className="text-xs text-destructive">
            {String(download.error)}
          </span>
        )}
      </div>
      {source.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(source.error)}
        </p>
      )}
      {source.isLoading && <p className="text-xs text-muted-foreground">Quellcode wird geladen…</p>}
      {source.data?.format === "eszip" && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Supabase liefert diese Funktion nur als gebündeltes ESZIP ({formatSize(source.data.size)}
          ). Lade sie herunter und entpacke sie mit der Supabase CLI.
        </p>
      )}
      {files.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
          <ul className="space-y-0.5">
            {files.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => setSelected(item.path)}
                  className={`w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs ${file?.path === item.path ? "bg-primary/10" : "hover:bg-muted"}`}
                  title={item.path}
                >
                  {item.path}
                </button>
              </li>
            ))}
          </ul>
          <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-xs">
            {file?.content ?? `Binärdatei (${formatSize(file?.size ?? 0)})`}
          </pre>
        </div>
      )}
    </div>
  );
}
