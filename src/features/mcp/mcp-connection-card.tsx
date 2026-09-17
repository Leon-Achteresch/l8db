import { AlertTriangle, Lock, Shield } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ProviderLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { type McpConnection, mcpConnectionUnsupported } from "@/lib/mcp";
import { cn } from "@/lib/utils";

interface McpConnectionCardProps {
  connection: McpConnection;
  onUpdate: (patch: Partial<McpConnection>) => void;
}

export function McpConnectionCard({ connection, onUpdate }: McpConnectionCardProps) {
  const unsupported = mcpConnectionUnsupported(connection);
  const isDisabled = unsupported !== null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-4 transition-all duration-200",
        connection.exposed
          ? "border-primary/40 bg-card/90 shadow-sm ring-1 ring-primary/10"
          : "border-border/80 bg-card/50 hover:border-border",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background/80 p-2 shadow-2xs">
            <ProviderLogo kind={connection.kind} className="size-5" />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {connection.name}
              </span>
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider">
                {connection.kind}
              </Badge>
              {unsupported ? (
                <Badge variant="destructive" className="text-[10px] font-normal">
                  {unsupported}
                </Badge>
              ) : connection.exposed ? (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]"
                >
                  Freigegeben
                </Badge>
              ) : null}
            </div>

            <p className="truncate font-mono text-[11px] text-muted-foreground/80 max-w-md">
              {connection.connectionString}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t border-border/40 pt-2 sm:border-0 sm:pt-0">
          <span className="text-xs font-medium text-muted-foreground">
            {connection.exposed ? "Freigabe aktiv" : "Gesperrt"}
          </span>
          <Switch
            checked={connection.exposed}
            disabled={isDisabled}
            onCheckedChange={(exposed) => onUpdate({ exposed })}
            aria-label={`${connection.name} freigeben`}
          />
        </div>
      </div>

      <AnimatePresence>
        {connection.exposed ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 border-t border-border/60 pt-4"
          >
            <div className="grid gap-4 sm:grid-cols-3">
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
