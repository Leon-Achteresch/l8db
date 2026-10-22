import { Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DbExtension } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabaseExtensionsTab({ reference }: { reference: string }) {
  const [filter, setFilter] = useState("all");
  const list = useDatabaseList<DbExtension>(reference, "extensions", {
    parent: filter === "all" ? "" : filter,
  });
  const action = useDatabaseAction(reference);
  const [target, setTarget] = useState("extensions");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Erweiterungen gefunden."
        toolbar={
          <>
            <Select
              value={filter}
              onValueChange={(value) => {
                setFilter(value);
                list.setOffset(0);
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="installed">Aktiviert</SelectItem>
                <SelectItem value="available">Verfügbar</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 w-36 text-xs"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="Ziel-Schema"
              aria-label="Ziel-Schema für neue Erweiterungen"
              title="Schema, in dem Erweiterungen aktiviert werden"
            />
          </>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Version", "Schema", "Beschreibung", ""]}>
            {items.map((extension) => (
              <tr key={extension.name}>
                <td className="font-medium">
                  {extension.name}{" "}
                  {extension.installed_version && <Badge variant="secondary">Aktiv</Badge>}
                </td>
                <td>{extension.installed_version ?? extension.default_version}</td>
                <td>{extension.schema ?? "–"}</td>
                <td className="max-w-96 text-muted-foreground">{extension.comment}</td>
                <td className="text-right">
                  {extension.installed_version ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setConfirm({
                          title: `Erweiterung „${extension.name}“ deaktivieren?`,
                          description:
                            "Die Erweiterung und ihre Objekte werden aus der Datenbank entfernt.",
                          confirmLabel: "Deaktivieren",
                          action: {
                            action: "disable_extension",
                            name: extension.name,
                            cascade: false,
                          },
                          cascade: true,
                        })
                      }
                    >
                      <PowerOff /> Deaktivieren
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={action.isPending || !target.trim()}
                      onClick={() =>
                        action.mutate({
                          action: "enable_extension",
                          name: extension.name,
                          schema: target.trim(),
                        })
                      }
                    >
                      <Power /> Aktivieren
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DatabaseTable>
        )}
      </DatabaseListFrame>
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
