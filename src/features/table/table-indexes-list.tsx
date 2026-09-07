import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, LayersIcon, LinkIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useConstraintsQuery, useIndexesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

interface TableIndexesListProps {
  schema: string;
  table: string;
}

function constraintTypeColor(type: string) {
  switch (type) {
    case "PRIMARY KEY":
      return "text-amber-500";
    case "UNIQUE":
      return "text-blue-500";
    case "FOREIGN KEY":
      return "text-violet-500";
    case "CHECK":
      return "text-emerald-500";
    case "EXCLUDE":
      return "text-orange-500";
    default:
      return "text-muted-foreground";
  }
}

function ConstraintTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "PRIMARY KEY":
      return <KeyRoundIcon className="size-4 text-amber-500" />;
    case "FOREIGN KEY":
      return <LinkIcon className="size-4 text-violet-500" />;
    case "UNIQUE":
      return <ShieldCheckIcon className="size-4 text-blue-500" />;
    default:
      return <ShieldCheckIcon className="size-4 text-emerald-500" />;
  }
}

interface CreateIndexDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  table: string;
  onSuccess: () => void;
}

function CreateIndexDialog({
  open,
  onOpenChange,
  schema,
  table,
  onSuccess,
}: CreateIndexDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [sql, setSql] = useState(`CREATE INDEX ON "${schema}"."${table}" (column_name);`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!connection || !sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
      );
      toast.success("Index erstellt.");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Neuer Index</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={5}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
          {error && (
            <pre className="whitespace-pre-wrap break-all rounded-md bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive select-text">
              {error}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleRun} disabled={running || !sql.trim()}>
            {running ? "Ausführen…" : "Ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TableIndexesList({ schema, table }: TableIndexesListProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: indexes, isLoading: indexesLoading } = useIndexesQuery(schema, table);
  const { data: constraints, isLoading: constraintsLoading } = useConstraintsQuery(schema, table);
  const [createOpen, setCreateOpen] = useState(false);

  const isLoading = indexesLoading || constraintsLoading;

  const handleIndexCreated = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["indexes", connection?.id, database, schema, table],
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Indexes & Constraints…
      </div>
    );
  }

  const hasIndexes = (indexes?.length ?? 0) > 0;
  const hasConstraints = (constraints?.length ?? 0) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Indexes & Constraints</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Neuer Index
        </Button>
      </div>

      {!hasIndexes && !hasConstraints ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Keine Indexes oder Constraints gefunden.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {hasConstraints && (
            <section>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <ShieldCheckIcon className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Constraints
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{constraints!.length}</span>
              </div>
              <div className="divide-y">
                {constraints!.map((con) => (
                  <motion.div
                    key={con.name}
                    layout
                    transition={{ layout: SPRING_LAYOUT }}
                    className="px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        <ConstraintTypeIcon type={con.constraint_type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-medium font-mono text-foreground">
                            {con.name}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-medium ${constraintTypeColor(con.constraint_type)} border-current/20 bg-current/5`}
                          >
                            {con.constraint_type}
                          </Badge>
                        </div>
                        {con.columns.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {con.columns.map((col) => (
                              <span
                                key={col}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                              >
                                {col}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="font-mono text-[11px] text-muted-foreground/70 break-all">
                          {con.definition}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {hasIndexes && (
            <section>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <LayersIcon className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Indexes
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{indexes!.length}</span>
              </div>
              <div className="divide-y">
                {indexes!.map((idx) => (
                  <motion.div
                    key={idx.name}
                    layout
                    transition={{ layout: SPRING_LAYOUT }}
                    className="px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {idx.is_primary ? (
                          <KeyRoundIcon className="size-4 text-amber-500" />
                        ) : (
                          <LayersIcon
                            className={`size-4 ${idx.is_unique ? "text-blue-500" : "text-muted-foreground"}`}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-medium font-mono text-foreground">
                            {idx.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {idx.index_type.toUpperCase()}
                          </Badge>
                          {idx.is_primary && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-amber-500 border-amber-500/20 bg-amber-500/5"
                            >
                              PRIMARY
                            </Badge>
                          )}
                          {idx.is_unique && !idx.is_primary && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 text-blue-500 border-blue-500/20 bg-blue-500/5"
                            >
                              UNIQUE
                            </Badge>
                          )}
                        </div>
                        {idx.columns.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {idx.columns.map((col) => (
                              <span
                                key={col}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                              >
                                {col}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="font-mono text-[11px] text-muted-foreground/70 break-all">
                          {idx.definition}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <CreateIndexDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        schema={schema}
        table={table}
        onSuccess={handleIndexCreated}
      />
    </div>
  );
}
