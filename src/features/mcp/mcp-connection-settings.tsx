import { AlertTriangle, Lock, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { McpConnection } from "@/lib/mcp";
import { cn } from "@/lib/utils";

export function McpConnectionSettings({
  connection,
  onUpdate,
}: {
  connection: McpConnection;
  onUpdate: (patch: Partial<McpConnection>) => void;
}) {
  return (
    <div data-no-toggle className="mt-4 grid gap-2 border-t border-border/40 pt-3">
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 p-2.5">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <div>
            <p className="text-xs font-medium text-foreground">Nur Lesen</p>
            <p className="text-[10px] text-muted-foreground">Verhindert Schreibbefehle</p>
          </div>
        </div>
        <Switch
          checked={connection.readOnly}
          onCheckedChange={(readOnly) =>
            onUpdate({
              readOnly,
              allowDdl: readOnly ? false : connection.allowDdl,
            })
          }
          aria-label={`${connection.name} nur lesen`}
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 p-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "size-4",
              connection.allowDdl ? "text-amber-500" : "text-muted-foreground",
            )}
          />
          <div>
            <p className="text-xs font-medium text-foreground">DDL erlauben</p>
            <p className="text-[10px] text-muted-foreground">Tabellen anlegen/ändern</p>
          </div>
        </div>
        <Switch
          checked={connection.allowDdl}
          disabled={connection.readOnly}
          onCheckedChange={(allowDdl) => onUpdate({ allowDdl })}
          aria-label={`${connection.name} DDL erlauben`}
        />
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background/50 p-2.5">
        <label
          htmlFor={`mcp-redact-${connection.id}`}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground"
        >
          <Lock className="size-3.5 text-muted-foreground" />
          Spaltenmaskierung
        </label>
        <Input
          id={`mcp-redact-${connection.id}`}
          className="h-7 font-mono text-[11px] bg-background"
          defaultValue={connection.redactColumns.join(", ")}
          placeholder="z. B. passwort, iban, geheim.*"
          onBlur={(event) =>
            onUpdate({
              redactColumns: event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
    </div>
  );
}
