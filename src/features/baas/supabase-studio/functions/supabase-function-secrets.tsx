import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  supabaseEdgeSecretDelete,
  supabaseEdgeSecretSet,
  supabaseEdgeSecrets,
} from "@/lib/db/supabase-studio-edge";
import { SupabaseFunctionConfirmDialog } from "./supabase-function-confirm-dialog";

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

export function SupabaseFunctionSecrets({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["supabase", reference, "edge-secrets"];
  const secrets = useQuery({ queryKey, queryFn: () => supabaseEdgeSecrets(reference) });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => supabaseEdgeSecretSet(reference, name.trim(), value),
    onSuccess: async () => {
      setName("");
      setValue("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const remove = useMutation({
    mutationFn: (secret: string) => supabaseEdgeSecretDelete(reference, secret),
    onSuccess: async () => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const nameValid =
    SECRET_NAME.test(name.trim()) && !name.trim().toUpperCase().startsWith("SUPABASE_");

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          className="h-8 w-56 font-mono text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="NAME"
          aria-label="Secret-Name"
        />
        <Input
          type="password"
          className="h-8 min-w-48 flex-1 text-xs"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Wert"
          aria-label="Secret-Wert"
        />
        <Button size="sm" type="submit" disabled={!nameValid || !value || save.isPending}>
          {save.isPending ? "Wird gespeichert…" : "Setzen"}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Bestehende Secrets mit gleichem Namen werden überschrieben. Supabase zeigt Werte nur als
        Hash; Namen mit SUPABASE_ sind reserviert.
      </p>
      {[save, remove].map(
        (mutation, index) =>
          mutation.isError && (
            <p
              key={index === 0 ? "save" : "remove"}
              role="alert"
              className="text-xs text-destructive"
            >
              {String(mutation.error)}
            </p>
          ),
      )}
      {secrets.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(secrets.error)}
        </p>
      )}
      {secrets.isLoading && (
        <p className="text-xs text-muted-foreground">Secrets werden geladen…</p>
      )}
      {secrets.data && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium">Hash</th>
              <th className="py-1 font-medium">Aktualisiert</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {secrets.data.map((secret) => (
              <tr key={secret.name} className="border-t">
                <td className="py-1.5 font-mono">{secret.name}</td>
                <td className="max-w-48 truncate py-1.5 font-mono text-muted-foreground">
                  {secret.value ?? "–"}
                </td>
                <td className="py-1.5 text-muted-foreground">
                  {secret.updated_at ? new Date(secret.updated_at).toLocaleString("de-DE") : "–"}
                </td>
                <td>
                  {!secret.name.startsWith("SUPABASE_") && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${secret.name} löschen`}
                      onClick={() => setPendingDelete(secret.name)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {secrets.data.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-muted-foreground">
                  Noch keine Secrets.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <SupabaseFunctionConfirmDialog
        open={pendingDelete !== null}
        title="Secret löschen?"
        description={`${pendingDelete ?? ""} wird entfernt. Funktionen, die es lesen, erhalten danach keinen Wert mehr.`}
        action="Löschen"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      />
    </div>
  );
}
