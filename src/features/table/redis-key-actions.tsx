import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  REDIS_ACTIONS,
  type RedisAction,
  redisActionCommand,
  redisReadCommand,
} from "@/lib/redis-commands";
import { effectiveConnectionString } from "@/lib/ssh";

export function RedisKeyActions() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [action, setAction] = useState<RedisAction>("get");
  const [value, setValue] = useState("");
  const [field, setField] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasValue = !["get", "delete", "persist"].includes(action);
  const hasField = ["hash", "zset", "stream"].includes(action);

  const run = async () => {
    if (!connection || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (connection.readOnly && action !== "get")
        throw Error("Diese Verbindung ist schreibgeschützt.");
      const response = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        redisActionCommand(action, key, value, field),
        database ?? undefined,
      );
      if (action === "get") {
        const command = redisReadCommand(key, String(response.rows[0]?.result));
        if (command) {
          const data = await executeQuery(
            connection.kind,
            effectiveConnectionString(connection),
            command,
            database ?? undefined,
          );
          response.rows.push(...data.rows);
        }
      }
      const last = response.rows.at(-1)?.result;
      if (action === "rename" && last === 0)
        throw Error("Der Ziel-Key existiert bereits. Es wurde nichts überschrieben.");
      setResult(
        JSON.stringify(
          action === "get"
            ? {
                type: response.rows[0]?.result,
                ttl: response.rows[1]?.result,
                value: response.rows[2]?.result ?? null,
              }
            : { result: last },
          null,
          2,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rows", connection.id, database] }),
        queryClient.invalidateQueries({ queryKey: ["count", connection.id, database] }),
      ]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Key verwalten
      </Button>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Redis-Key verwalten</DialogTitle>
          <DialogDescription>
            Datenbank {database ?? "0"}. Weitere Befehle stehen im Redis-Editor zur Verfügung.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="redis-key">Key</Label>
            <Input
              id="redis-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="user:1"
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="redis-action">Aktion</Label>
            <Select
              value={action}
              onValueChange={(next) => {
                setAction(next as RedisAction);
                setResult(null);
                setError(null);
              }}
              disabled={busy}
            >
              <SelectTrigger id="redis-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REDIS_ACTIONS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasField && (
            <div className="space-y-1">
              <Label htmlFor="redis-field">{action === "zset" ? "Score" : "Feld"}</Label>
              <Input
                id="redis-field"
                value={field}
                onChange={(event) => setField(event.target.value)}
                disabled={busy}
              />
            </div>
          )}
          {hasValue && (
            <div className="space-y-1">
              <Label htmlFor="redis-value">
                {action === "expire"
                  ? "TTL (Sekunden)"
                  : action === "rename"
                    ? "Neuer Key"
                    : "Wert"}
              </Label>
              <Textarea
                id="redis-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy}
                className="font-mono"
              />
            </div>
          )}
          {action === "string" && (
            <p className="text-xs text-muted-foreground">
              Ersetzt den bisherigen Wert. Eine bestehende Ablaufzeit bleibt erhalten.
            </p>
          )}
          {action === "delete" && (
            <p className="text-sm text-destructive">
              Der Key mit allen enthaltenen Werten wird gelöscht.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {result !== null && (
            <pre
              role="region"
              aria-label="Redis-Ergebnis"
              className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all"
            >
              {result}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void run()}
            disabled={busy}
            variant={action === "delete" ? "destructive" : "default"}
          >
            {busy
              ? "Wird ausgeführt…"
              : action === "delete"
                ? "Key endgültig löschen"
                : "Ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
