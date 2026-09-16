import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type HostGroupRule, matchingHostRule } from "@/lib/connection-groups";
import { createConnectionId, useConnectionsStore } from "@/lib/connections";

interface Props {
  open: boolean;
  draft?: Omit<HostGroupRule, "id"> | null;
  onOpenChange: (open: boolean) => void;
}

export function HostGroupRulesDialog({ open, draft, onOpenChange }: Props) {
  const connections = useConnectionsStore((state) => state.connections);
  const [rules, setRules] = useState<HostGroupRule[]>([]);

  useEffect(() => {
    if (!open) return;
    const stored = useConnectionsStore.getState().hostGroupRules;
    setRules(draft ? [...stored, { ...draft, id: createConnectionId() }] : stored);
  }, [open, draft]);

  function update(id: string, patch: Partial<HostGroupRule>) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function save() {
    useConnectionsStore
      .getState()
      .setHostGroupRules(rules.filter((rule) => rule.pattern.trim() !== ""));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Host-Gruppen</DialogTitle>
          <DialogDescription>
            Fasse ähnliche Hosts per Muster zusammen, z. B. <code>db-prod*</code>. Mehrere Muster
            mit Komma trennen. Die erste passende Regel gewinnt; Verbindungen ohne Treffer bleiben
            nach Server gruppiert.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {rules.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Noch keine Regeln. Ohne Regeln wird nach exaktem Server gruppiert.
            </p>
          )}
          {rules.map((rule, index) => {
            const count = connections.filter(
              (connection) => matchingHostRule(connection, rules)?.id === rule.id,
            ).length;
            return (
              <div key={rule.id} className="flex items-center gap-2">
                <Input
                  value={rule.name}
                  placeholder="Name"
                  aria-label="Gruppenname"
                  onChange={(event) => update(rule.id, { name: event.target.value })}
                  className="w-44"
                />
                <Input
                  value={rule.pattern}
                  placeholder="db-prod*"
                  aria-label="Host-Muster"
                  autoFocus={Boolean(draft) && index === rules.length - 1}
                  onChange={(event) => update(rule.id, { pattern: event.target.value })}
                  className="flex-1 font-mono"
                />
                <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                  {count} {count === 1 ? "Verbindung" : "Verbindungen"}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Regel entfernen"
                  onClick={() =>
                    setRules((current) => current.filter((entry) => entry.id !== rule.id))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((current) => [
                ...current,
                { id: createConnectionId(), name: "", pattern: "" },
              ])
            }
          >
            <Plus className="size-4" />
            Regel
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={save}>
              Speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
