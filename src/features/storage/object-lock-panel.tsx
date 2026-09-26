import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { type ConfigTarget, s3GetConfig, s3PutConfig } from "@/lib/db";
import { legalHoldXml, parseLegalHold, parseRetention, retentionXml } from "@/lib/storage/s3";
import { errorText, formatDate, useStorageConnection } from "./use-storage-connection";

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ObjectLockPanel({
  bucket,
  objectKey,
  versionId,
  readOnly,
}: {
  bucket: string;
  objectKey: string;
  versionId: string | null;
  readOnly: boolean;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const target: ConfigTarget = { bucket, key: objectKey, versionId };
  const base = ["s3", connection?.id, "config", bucket, objectKey, versionId];
  const bucketLock = useQuery({
    queryKey: ["s3", connection?.id, "config", bucket, null, null, "object-lock"],
    queryFn: () => s3GetConfig(url, { bucket }, "object-lock"),
    retry: false,
  });
  const lockEnabled = Boolean(bucketLock.data?.includes("Enabled"));
  const retention = useQuery({
    queryKey: [...base, "retention"],
    queryFn: () => s3GetConfig(url, target, "retention"),
    enabled: lockEnabled,
    retry: false,
  });
  const hold = useQuery({
    queryKey: [...base, "legal-hold"],
    queryFn: () => s3GetConfig(url, target, "legal-hold"),
    enabled: lockEnabled,
    retry: false,
  });
  const current = parseRetention(retention.data ?? null);
  const [mode, setMode] = useState<"GOVERNANCE" | "COMPLIANCE">("GOVERNANCE");
  const [until, setUntil] = useState(localInput(new Date(Date.now() + 7 * 86400000)));
  const [bypass, setBypass] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (current.mode) setMode(current.mode);
    if (current.until) setUntil(localInput(new Date(current.until)));
  }, [current.mode, current.until]);

  if (bucketLock.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Prüfe Object Lock…
      </div>
    );
  }
  if (!lockEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Object Lock ist für diesen Bucket nicht aktiviert. Er lässt sich nur beim Anlegen eines
        Buckets einschalten.
      </p>
    );
  }

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const legalHold = parseLegalHold(hold.data ?? null);

  return (
    <div className="grid gap-5 text-sm">
      <section className="grid gap-2">
        <h3 className="font-medium">Aufbewahrung</h3>
        <p className="text-xs text-muted-foreground">
          {current.mode
            ? `${current.mode === "COMPLIANCE" ? "Compliance" : "Governance"} bis ${formatDate(current.until)}`
            : "Keine Aufbewahrung gesetzt."}
        </p>
        {retention.isError && (
          <p className="text-xs text-destructive">{errorText(retention.error)}</p>
        )}
        {!readOnly && (
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Modus</Label>
                <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GOVERNANCE">Governance</SelectItem>
                    <SelectItem value="COMPLIANCE">Compliance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="retain-until">
                  Aufbewahren bis
                </Label>
                <Input
                  id="retain-until"
                  type="datetime-local"
                  className="h-8 text-xs"
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={bypass} onCheckedChange={setBypass} />
              Governance umgehen (zum Verkürzen oder Entfernen)
            </label>
            <Button
              size="sm"
              className="justify-self-start"
              disabled={busy || !until}
              onClick={() =>
                void run(
                  () =>
                    s3PutConfig(
                      url,
                      target,
                      "retention",
                      retentionXml(mode, new Date(until)),
                      bypass,
                    ),
                  "Aufbewahrung gesetzt",
                )
              }
            >
              Aufbewahrung speichern
            </Button>
            {mode === "COMPLIANCE" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Compliance-Aufbewahrung kann von niemandem verkürzt oder entfernt werden.
              </p>
            )}
          </div>
        )}
      </section>
      <section className="grid gap-2">
        <h3 className="font-medium">Legal Hold</h3>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={legalHold}
            disabled={readOnly || busy || hold.isLoading}
            onCheckedChange={(on) =>
              void run(
                () => s3PutConfig(url, target, "legal-hold", legalHoldXml(on)),
                on ? "Legal Hold aktiv" : "Legal Hold aufgehoben",
              )
            }
          />
          {legalHold ? "Aktiv – Objekt kann nicht gelöscht werden" : "Inaktiv"}
        </label>
      </section>
    </div>
  );
}
