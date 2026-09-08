import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import type { ServerGroup } from "@/lib/connection-groups";
import {
  connectionSummary,
  normalizeOracleHost,
  updateOracleConnectionEndpoint,
} from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import { activateConnection, closeSshTunnel } from "@/lib/ssh";

interface Props {
  open: boolean;
  group: ServerGroup;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionBulkEditDialog({ open, group, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const first = group.connections[0];
  const endpoint = first ? connectionSummary(first.connectionString, first.kind) : null;
  const [host, setHost] = useState(endpoint?.host ?? "");
  const [serviceName, setServiceName] = useState(endpoint?.database ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = group.connections[0];
    const next = current ? connectionSummary(current.connectionString, current.kind) : null;
    setHost(next?.host ?? "");
    setServiceName(next?.database ?? "");
  }, [group.key, open]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const hostValue = host.trim();
      const normalizedHost = normalizeOracleHost(hostValue);
      const serviceValue = serviceName.trim();
      if (!serviceValue) throw new Error("Der Service-Name ist erforderlich.");
      const ids = new Set(group.connections.map((connection) => connection.id));
      const store = useConnectionsStore.getState();
      if (store.activeId && ids.has(store.activeId)) {
        const outcome = await activateConnection(null);
        if (!outcome.ok)
          throw new Error(outcome.error ?? "Die aktive Verbindung konnte nicht getrennt werden.");
      }
      const current = useConnectionsStore
        .getState()
        .connections.filter((connection) => ids.has(connection.id));
      await Promise.all(
        current
          .filter((connection) => connection.tunnelPort)
          .map((connection) => closeSshTunnel(connection.id).catch(() => undefined)),
      );
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((connection) => {
          if (!ids.has(connection.id)) return connection;
          return {
            ...connection,
            connectionString: updateOracleConnectionEndpoint(
              connection.connectionString,
              hostValue,
              serviceValue,
            ),
            ssh: connection.ssh
              ? { ...connection.ssh, remoteHost: normalizedHost.replace(/^\[|\]$/g, "") }
              : connection.ssh,
            tunnelPort: null,
          };
        }),
      }));
      for (const connection of current) {
        queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === connection.id });
      }
      toast.success(`${current.length} Connections aktualisiert`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Host und Service-Name bearbeiten</DialogTitle>
          <DialogDescription>
            Die Werte werden für alle {group.connections.length} Connections dieser Gruppe gesetzt.
            Benutzer, Passwörter, Tags und Schema-Filter bleiben erhalten.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-connection-host" className="text-xs">
              Host oder Host:Port
            </Label>
            <Input
              id="bulk-connection-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              className="h-8 font-mono text-xs"
              placeholder="SLTEST oder SLTEST:1521"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-connection-service" className="text-xs">
              Service-Name
            </Label>
            <Input
              id="bulk-connection-service"
              value={serviceName}
              onChange={(event) => setServiceName(event.target.value)}
              className="h-8 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving || !host.trim() || !serviceName.trim()}>
              {saving ? "Speichern…" : `${group.connections.length} speichern`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
