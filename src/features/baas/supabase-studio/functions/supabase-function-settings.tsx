import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabaseDeleteFunction } from "@/lib/db";
import {
  type SupabaseEdgeFunctionDetails,
  supabaseEdgeFunction,
  supabaseEdgeFunctionUpdate,
} from "@/lib/db/supabase-studio-edge";
import { SupabaseFunctionConfirmDialog } from "./supabase-function-confirm-dialog";
import type { SupabaseFunctionDeployTarget } from "./supabase-function-deploy-dialog";

function formatTime(value: number | string | undefined) {
  if (value == null) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-DE");
}

export function SupabaseFunctionSettings({
  reference,
  slug,
  onDeploy,
  onDeleted,
}: {
  reference: string;
  slug: string;
  onDeploy: (target: SupabaseFunctionDeployTarget) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const details = useQuery({
    queryKey: ["supabase", reference, "function", slug],
    queryFn: () => supabaseEdgeFunction(reference, slug),
  });
  const [draft, setDraft] = useState<{ name: string; verifyJwt: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = details.data;
  const name = draft?.name ?? data?.name ?? slug;
  const verifyJwt = draft?.verifyJwt ?? data?.verify_jwt ?? true;
  const save = useMutation({
    mutationFn: () => supabaseEdgeFunctionUpdate(reference, slug, name.trim(), verifyJwt),
    onSuccess: (updated) => {
      queryClient.setQueryData<SupabaseEdgeFunctionDetails>(
        ["supabase", reference, "function", slug],
        (previous) => ({ ...previous, ...updated }),
      );
      void queryClient.invalidateQueries({ queryKey: ["supabase", reference, "functions"] });
      setDraft(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => supabaseDeleteFunction(reference, slug),
    onSuccess: async () => {
      setConfirmDelete(false);
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "functions"] });
      queryClient.removeQueries({ queryKey: ["supabase", reference, "function", slug] });
      onDeleted();
    },
  });

  if (details.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(details.error)}
      </p>
    );
  }
  if (!data) return <p className="text-xs text-muted-foreground">Details werden geladen…</p>;

  const facts: [string, string][] = [
    ["Status", data.status ?? "–"],
    ["Version", data.version != null ? String(data.version) : "–"],
    ["Einstiegspunkt", data.entrypoint_path ?? "–"],
    ["Import Map", data.import_map_path ?? (data.import_map ? "ja" : "–")],
    ["Erstellt", formatTime(data.created_at)],
    ["Aktualisiert", formatTime(data.updated_at)],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[120px_minmax(0,1fr)]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <form
        className="grid max-w-md gap-3 rounded-xl border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="edge-function-name">Name</Label>
          <Input
            id="edge-function-name"
            value={name}
            onChange={(event) => setDraft({ name: event.target.value, verifyJwt })}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id="edge-function-jwt"
            checked={verifyJwt}
            onCheckedChange={(checked) => setDraft({ name, verifyJwt: checked })}
          />
          <Label htmlFor="edge-function-jwt">JWT prüfen (verify_jwt)</Label>
        </div>
        {save.isError && (
          <p role="alert" className="text-xs text-destructive">
            {String(save.error)}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={!draft || !name.trim() || save.isPending}>
            {save.isPending ? "Wird gespeichert…" : "Speichern"}
          </Button>
          {draft && (
            <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>
              Verwerfen
            </Button>
          )}
        </div>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDeploy({ slug, name: data.name ?? slug, verifyJwt })}
        >
          <Upload className="size-3.5" /> Neue Version deployen
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-3.5" /> Löschen
        </Button>
      </div>
      {remove.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(remove.error)}
        </p>
      )}
      <SupabaseFunctionConfirmDialog
        open={confirmDelete}
        title="Edge Function löschen?"
        description={`${slug} wird mit allen Versionen endgültig gelöscht. Aufrufe der Funktion schlagen danach fehl.`}
        action="Löschen"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onOpenChange={setConfirmDelete}
      />
    </div>
  );
}
