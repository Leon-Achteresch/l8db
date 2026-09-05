import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { PencilIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { useActiveDatabase } from "@/lib/db-selection";
import { alterSequence, type AlterSequenceRequest, type SequenceInfo } from "@/lib/db";
import { useSequencesQuery } from "@/lib/queries";

interface EditSequenceDialogProps {
  sequence: SequenceInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function EditSequenceDialog({ sequence, open, onOpenChange, onSuccess }: EditSequenceDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AlterSequenceRequest>({
    increment_by: sequence.increment_by,
    min_value: sequence.min_value,
    max_value: sequence.max_value,
    cycle: sequence.cycle,
    restart_with: "",
  });

  const handleSave = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const changes: AlterSequenceRequest = {};
      if (form.increment_by !== sequence.increment_by) changes.increment_by = form.increment_by;
      if (form.min_value !== sequence.min_value) changes.min_value = form.min_value;
      if (form.max_value !== sequence.max_value) changes.max_value = form.max_value;
      if (form.cycle !== sequence.cycle) changes.cycle = form.cycle;
      if (form.restart_with && form.restart_with.trim() !== "") changes.restart_with = form.restart_with;

      await alterSequence(
        connection.kind,
        effectiveConnectionString(connection),
        sequence.schema,
        sequence.name,
        changes,
        database ?? undefined,
      );
      toast.success(`Sequenz "${sequence.name}" aktualisiert.`);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {sequence.schema}.{sequence.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Inkrement</Label>
              <Input
                value={form.increment_by ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, increment_by: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.increment_by}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Neu starten mit</Label>
              <Input
                value={form.restart_with ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, restart_with: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder="optional"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Minimalwert</Label>
              <Input
                value={form.min_value ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, min_value: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.min_value}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Maximalwert</Label>
              <Input
                value={form.max_value ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, max_value: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.max_value}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Switch
              id="cycle"
              checked={form.cycle ?? false}
              onCheckedChange={(v) => setForm((f) => ({ ...f, cycle: v }))}
            />
            <Label htmlFor="cycle" className="text-xs cursor-pointer">
              Zyklisch (CYCLE)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SequencesView() {
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const { data: sequences, isLoading, isError, error } = useSequencesQuery();
  const [search, setSearch] = useState("");
  const [editingSequence, setEditingSequence] = useState<SequenceInfo | null>(null);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full bg-muted/30" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <p className="text-xs text-muted-foreground font-mono break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = (sequences ?? []).filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.schema.toLowerCase().includes(q),
  );

  const handleEditSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sequences"] });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Sequenzen
        </span>
        {sequences && sequences.length > 0 && (
          <span className="text-xs text-muted-foreground">
            ({sequences.length})
          </span>
        )}
      </div>

      {!sequences || sequences.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Keine Sequenzen gefunden.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 py-2">
            <div className="relative max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Suche…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Keine Treffer.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Schema
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Datentyp
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Start
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Min
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Max
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Inkrement
                    </th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                      Zyklisch
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Letzter Wert
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Aktionen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((seq) => (
                    <tr
                      key={`${seq.schema}.${seq.name}`}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                        {seq.schema}
                      </td>
                      <td className="px-4 py-2 font-medium font-mono text-xs">
                        {seq.name}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {seq.data_type}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                        {seq.start_value}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {seq.min_value}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {seq.max_value}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                        {seq.increment_by}
                      </td>
                      <td className="px-4 py-2 text-center text-xs">
                        {seq.cycle ? "Ja" : "Nein"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                        {seq.last_value ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setEditingSequence(seq)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {editingSequence && (
        <EditSequenceDialog
          sequence={editingSequence}
          open={editingSequence !== null}
          onOpenChange={(open) => { if (!open) setEditingSequence(null); }}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}
