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
import { useCapabilities } from "@/lib/providers";
import { isConnectionQuery } from "@/lib/query-client";
import {
  createSessionView,
  expandSessionViews,
  sessionViewsFor,
  temporaryViewMode,
} from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh/connection-string";

export function isViewableSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /^(select|with)\b/i.test(trimmed) && !trimmed.includes(";");
}

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
  const persistentAllowed = useCapabilities(connection.kind).views;
  const tempMode = temporaryViewMode(connection.kind);
  const [name, setName] = useState("");
  const [temporaryChoice, setTemporaryChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const temporary = tempMode !== null && (temporaryChoice || !persistentAllowed);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (temporary && tempMode === "emulated") {
        await createSessionView(connection, database, name, sql);
        toast.success(`Sitzungs-View ${name.trim()} angelegt`);
      } else {
        const expanded = expandSessionViews(
          sql,
          sessionViewsFor(connection.id, database),
          connection.kind,
        );
        await executeQuery(
          connection.kind,
          effectiveConnectionString(connection),
          createViewSql(name, expanded, connection.kind, temporary),
          database ?? undefined,
        );
        await queryClient.invalidateQueries({
          predicate: (query) => isConnectionQuery(query.queryKey, connection.id),
        });
        toast.success(`${temporary ? "Temporäre View" : "View"} ${name.trim()} erstellt`);
      }
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
              {persistentAllowed
                ? "Die aktuelle Abfrage wird als View in der Datenbank gespeichert."
                : "Die aktuelle Abfrage wird als Sitzungs-View nur in l8db gespeichert."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="create-view-name">Name</Label>
            <Input
              id="create-view-name"
              autoFocus
              value={name}
              placeholder={temporary ? "view_name" : "schema.view_name"}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {tempMode !== null && persistentAllowed && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="create-view-temporary"
                className="mt-0.5"
                checked={temporaryChoice}
                onCheckedChange={(v) => setTemporaryChoice(Boolean(v))}
              />
              <Label htmlFor="create-view-temporary" className="text-xs font-normal leading-snug">
                Temporär, nur für diese Sitzung
                <span className="block text-muted-foreground">
                  {tempMode === "native"
                    ? "Wird als TEMP VIEW auf der Verbindung angelegt und verschwindet beim Trennen."
                    : "Wird nicht in der Datenbank angelegt. l8db setzt die Abfrage beim Ausführen als CTE ein; die View verschwindet beim Trennen der Verbindung."}
                </span>
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
