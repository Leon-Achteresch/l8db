import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { SavedConnection } from "@/lib/connections/types";
import { executeQuery } from "@/lib/db";
import { errorMessageOf } from "@/lib/error-details";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { isConnectionQuery } from "@/lib/query-client";
import { effectiveConnectionString } from "@/lib/ssh/connection-string";

export function isViewableSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /^(select|with)\b/i.test(trimmed) && !trimmed.includes(";");
}

export const TEMP_VIEW_KINDS: ReadonlySet<SavedConnection["kind"]> = new Set(["sqlite", "duckdb"]);

export function createViewSql(
  name: string,
  sql: string,
  kind: SavedConnection["kind"],
  temporary = false,
): string {
  const style = identifierStyleForKind(kind);
  const target = name
    .trim()
    .split(".")
    .map((part) => (/^["`[]/.test(part) ? part : quoteIdentifier(part, style)))
    .join(".");
  return `CREATE ${temporary ? "TEMP " : ""}VIEW ${target} AS ${sql.trim().replace(/;\s*$/, "")}`;
}

export function CreateViewDialog({
  open,
  onOpenChange,
  sql,
  connection,
  database,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql: string;
  connection: SavedConnection;
  database: string | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [temporary, setTemporary] = useState(false);
  const temporaryAllowed = TEMP_VIEW_KINDS.has(connection.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        createViewSql(name, sql, connection.kind, temporaryAllowed && temporary),
        database ?? undefined,
      );
      await queryClient.invalidateQueries({
        predicate: (query) => isConnectionQuery(query.queryKey, connection.id),
      });
      toast.success(
        `${temporaryAllowed && temporary ? "Temporäre View" : "View"} ${name.trim()} erstellt`,
      );
      setName("");
      onOpenChange(false);
    } catch (e) {
      setError(errorMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>View aus Abfrage erstellen</DialogTitle>
            <DialogDescription>
              Die aktuelle Abfrage wird als View in der Datenbank gespeichert.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="create-view-name">Name</Label>
            <Input
              id="create-view-name"
              autoFocus
              value={name}
              placeholder="schema.view_name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {temporaryAllowed && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-view-temporary"
                checked={temporary}
                onCheckedChange={(v) => setTemporary(Boolean(v))}
              />
              <Label htmlFor="create-view-temporary" className="text-xs font-normal">
                Temporär, nur für diese Sitzung (verschwindet beim Trennen der Verbindung)
              </Label>
            </div>
          )}
          {error ? <p className="text-xs break-words text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Spinner className="size-4" /> : null}
              Erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
