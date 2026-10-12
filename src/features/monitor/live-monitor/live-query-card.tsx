import { CopyIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSeconds } from "@/features/monitor/monitor-view/format";
import type { SessionInfo } from "@/lib/db";
import { cn } from "@/lib/utils";
import { tokenizeSqlLine } from "./sql-tokens";
import { type LiveMonitorState, sessionRuntime } from "./use-live-monitor";

const MAX_LINES = 400;

export function LiveQueryCard({
  m,
  session,
  bare = false,
}: {
  m: LiveMonitorState;
  session: SessionInfo;
  bare?: boolean;
}) {
  const sql = session.query.trim();
  const lines = sql ? sql.split("\n").slice(0, MAX_LINES) : [];
  const body = !sql ? (
    <p className="p-4 text-center text-xs text-muted-foreground">Keine Abfrage vorhanden.</p>
  ) : (
    <div className="max-h-72 overflow-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className="flex">
          <span className="w-8 shrink-0 pr-3 text-right text-muted-foreground/70 select-none">
            {index + 1}
          </span>
          <span className="whitespace-pre pr-3">
            {tokenizeSqlLine(line).map((token, tokenIndex) => (
              <span
                key={`${tokenIndex}-${token.text}`}
                className={cn(
                  token.kind === "keyword" && "text-blue-600 dark:text-blue-400",
                  token.kind === "string" && "text-emerald-700 dark:text-emerald-400",
                  token.kind === "number" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {token.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
  const actions = (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!sql}
        aria-label="Abfrage kopieren"
        title="Abfrage kopieren"
        onClick={() => m.copyQuery(sql)}
      >
        <CopyIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!sql}
        aria-label="Im Query-Editor öffnen"
        title="Im Query-Editor öffnen"
        onClick={() => m.openInEditor(sql, session.pid)}
      >
        <SquareArrowOutUpRightIcon />
      </Button>
    </div>
  );
  if (bare)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Laufzeit {formatSeconds(sessionRuntime(session, m.now))}</span>
          {actions}
        </div>
        {body}
      </div>
    );
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="flex items-center gap-2">
        <CardTitle className="text-sm">Aktuelle Abfrage</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          Laufzeit: {formatSeconds(sessionRuntime(session, m.now))}
        </span>
        <CardAction>{actions}</CardAction>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
