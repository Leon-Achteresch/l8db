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
import { statusLabel } from "../supabase-services";
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
    ["Status", data.status ? statusLabel(data.status) : "–"],
    ["Version", data.version != null ? String(data.version) : "–"],
    ["Einstiegspunkt", data.entrypoint_path ?? "–"],
    ["Import Map", data.import_map_path ?? (data.import_map ? "ja" : "–")],
    ["Erstellt", formatTime(data.created_at)],
    ["Aktualisiert", formatTime(data.updated_at)],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-xs lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-card px-3 py-2.5">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 truncate font-mono" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="grid content-start gap-3 rounded-xl border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h4 className="text-xs font-semibold">Konfiguration</h4>
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
        <section className="grid content-start gap-3 rounded-xl border bg-card p-4">
          <h4 className="text-xs font-semibold">Versionen</h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ein neues Deployment ersetzt Version {data.version ?? "–"}. Löschen entfernt die
            Funktion mit allen Versionen.
          </p>
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
        </section>
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
