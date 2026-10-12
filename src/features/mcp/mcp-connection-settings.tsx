import {
  AlertTriangle,
  ListOrdered,
  Lock,
  MoreHorizontal,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { McpConnection } from "@/lib/mcp";
import { cn } from "@/lib/utils";

export function McpConnectionSettings({
  connection,
  onUpdate,
}: {
  connection: McpConnection;
  onUpdate: (patch: Partial<McpConnection>) => void;
}) {
  const titleId = useId();
  const scripts = useNewFeatureVisibility<HTMLDivElement>("mcp.scripts");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${connection.name} MCP-Einstellungen`}
          className="text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-no-toggle
        align="end"
        sideOffset={8}
        aria-labelledby={titleId}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto rounded-xl p-0 max-h-[var(--radix-popover-content-available-height)]"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold">
            MCP-Einstellungen
          </h3>
          <p className="truncate text-xs text-muted-foreground">{connection.name}</p>
        </div>
        <div className="grid gap-4 p-4">
          <div className="flex items-center justify-between gap-4">
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

          {connection.environment === "production" && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-red-500" />
                <div>
                  <p className="text-xs font-medium text-foreground">Produktion beschreiben</p>
                  <p className="text-[10px] text-muted-foreground">
                    Ohne Freigabe verweigert der MCP Schreibzugriffe
                  </p>
                </div>
              </div>
              <Switch
                checked={connection.allowProductionWrites}
                disabled={connection.readOnly}
                onCheckedChange={(allowProductionWrites) => onUpdate({ allowProductionWrites })}
                aria-label={`${connection.name} Produktion beschreiben`}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
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

          <div ref={scripts.ref} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <ListOrdered
                className={cn(
                  "size-4",
                  connection.allowScripts ? "text-amber-500" : "text-muted-foreground",
                )}
              />
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  Skripte erlauben
                  {scripts.isNew ? <NewBadge /> : null}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Mehrere Statements und SQL*Plus in einer Transaktion
                </p>
              </div>
            </div>
            <Switch
              checked={connection.allowScripts}
              onCheckedChange={(allowScripts) => onUpdate({ allowScripts })}
              aria-label={`${connection.name} Skripte erlauben`}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
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
      </PopoverContent>
    </Popover>
  );
}
