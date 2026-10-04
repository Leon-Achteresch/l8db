import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { DownloadIcon, RefreshCwIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { branchingAudit, branchingAuditExport } from "@/lib/db";
import { cn } from "@/lib/utils";
import { VersioningIconButton } from "../versioning-icon-button";
import type { BranchingWorkspace } from "./use-branching";

const ACTIONS: Record<string, string> = {
  "snapshot.create": "Sicherung erstellt",
  "snapshot.verify": "Sicherung geprüft",
  "snapshot.settings": "Sicherung bearbeitet",
  "snapshot.delete": "Sicherung gelöscht",
  "branch.create": "Branch erstellt",
  "branch.reset": "Branch zurückgesetzt",
  "branch.delete": "Branch gelöscht",
  "branch.rename": "Branch umbenannt",
  "branch.settings": "Branch-Einstellungen geändert",
  "branch.sweep": "Abgelaufenes aufgeräumt",
  "database.restore": "Datenbank wiederhergestellt",
  "database.protect": "Schutzstufe geändert",
  "database.masking": "Team-Maskierung geändert",
  "policy.update": "Richtlinie geändert",
  "vault.recovery_export": "Wiederherstellungsschlüssel angezeigt",
  "vault.recovery_import": "Wiederherstellungsschlüssel importiert",
};

const OUTCOMES: Record<string, string> = {
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

export function AuditLog({ workspace }: { workspace: BranchingWorkspace }) {
  const [everything, setEverything] = useState(false);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["branching-audit"],
    retry: false,
    staleTime: 5_000,
    queryFn: () => branchingAudit(2000),
  });
  const identity = workspace.overview?.server.identity ?? "";
  const needle = search.trim().toLowerCase();
  const entries = (query.data?.entries ?? [])
    .filter(
      (entry) =>
        everything ||
        entry.database.startsWith(`${identity}/`) ||
        entry.database.startsWith("vault/"),
    )
    .filter(
      (entry) =>
        !needle ||
        [
          ACTIONS[entry.action] ?? entry.action,
          entry.database,
          entry.target,
          entry.actor.osUser,
          entry.actor.dbUser,
          JSON.stringify(entry.detail ?? {}),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    );
  const verification = query.data?.verification;
  const exportLog = async () => {
    try {
      const data = await branchingAuditExport();
      const path = await save({
        defaultPath: `l8db-protokoll-${new Date().toISOString().slice(0, 10)}.jsonl`,
        filters: [{ name: "Protokoll", extensions: ["jsonl"] }],
      });
      if (!path) return;
      await writeTextFile(path, data);
      toast.success("Protokoll exportiert.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="space-y-3" aria-label="Protokoll">
      {verification && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl p-3",
            verification.valid ? "bg-emerald-500/5" : "bg-destructive/5",
          )}
        >
          {verification.valid ? (
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="font-medium">
              {verification.valid
                ? `Lückenlos und unverändert · ${verification.entries} Einträge`
                : "Das Protokoll wurde verändert oder ist beschädigt"}
            </p>
            <p className="text-muted-foreground">
              {verification.valid
                ? "Jeder Eintrag ist signiert und mit seinem Vorgänger verkettet; der letzte Stand ist zusätzlich im Schlüsselbund verankert."
                : verification.problem}
            </p>
          </div>
          <VersioningIconButton
            icon={DownloadIcon}
            label="Protokoll exportieren"
            disabled={!verification.valid}
            onClick={() => void exportLog()}
          />
          <VersioningIconButton
            icon={RefreshCwIcon}
            label="Protokoll neu laden"
            onClick={() => void query.refetch()}
          />
        </div>
      )}
      {query.error && (
        <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Aktion, Datenbank, Person oder Grund suchen"
          aria-label="Protokoll durchsuchen"
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          Alle Server
          <Switch
            checked={everything}
            onCheckedChange={setEverything}
            aria-label="Einträge aller Server zeigen"
          />
        </label>
      </div>
      {query.isLoading && <Skeleton className="h-40 rounded-xl" />}
      {query.data && !entries.length && (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          {needle ? "Keine passenden Einträge." : "Noch keine Einträge für diesen Server."}
        </p>
      )}
      <ol className="space-y-0.5">
        {entries.map((entry) => {
          const detail = entry.detail ?? {};
          const reason = typeof detail.reason === "string" ? detail.reason : "";
          const error = typeof detail.error === "string" ? detail.error : "";
          const hasDetail = Object.keys(detail).length > 0;
          return (
            <li key={entry.seq} className="rounded-xl px-2 py-1.5 hover:bg-muted/40">
              <details className="group">
                <summary
                  className={cn(
                    "flex list-none items-baseline gap-2 text-xs",
                    hasDetail && "cursor-pointer",
                  )}
                >
                  <time
                    dateTime={entry.at}
                    className="w-28 shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground"
                  >
                    {new Date(entry.at).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{ACTIONS[entry.action] ?? entry.action}</span>
                    {OUTCOMES[entry.outcome] && (
                      <span
                        className={cn(
                          "ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                          entry.outcome === "failed"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {OUTCOMES[entry.outcome]}
                      </span>
                    )}
                    <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                      {entry.database.slice(entry.database.indexOf("/") + 1)}
                      {entry.target && entry.target !== entry.database ? ` → ${entry.target}` : ""}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {entry.actor.osUser}@{entry.actor.host}
                      {entry.actor.dbUser ? ` · Rolle ${entry.actor.dbUser}` : ""}
                      {reason ? ` · Grund: ${reason}` : ""}
                      {error ? ` · ${error}` : ""}
                    </span>
                  </span>
                </summary>
                {hasDetail && (
                  <pre className="mt-1.5 ml-30 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
