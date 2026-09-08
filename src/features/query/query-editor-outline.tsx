import { ListOrderedIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { splitSqlStatements, summarizeStatement } from "@/lib/sql-statements";

interface QueryEditorOutlineProps {
  sql: string;
  dialect?: string;
  onJump: (line: number, column: number) => void;
}

export function QueryEditorOutline({ sql, dialect, onJump }: QueryEditorOutlineProps) {
  const statements = useMemo(() => splitSqlStatements(sql, dialect).statements, [sql, dialect]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs"
          disabled={statements.length === 0}
          title="Statements im Skript auflisten und anspringen"
        >
          <ListOrderedIcon className="size-3" />
          Outline
          {statements.length > 0 && (
            <span className="tabular-nums text-muted-foreground">{statements.length}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-80 overflow-y-auto">
        {statements.map((statement, index) => {
          const summary = summarizeStatement(statement.text);
          const before = sql.slice(0, statement.start).split("\n");
          const line = before.length;
          const column = before[before.length - 1].length + 1;
          return (
            <DropdownMenuItem
              key={`${statement.start}-${statement.end}`}
              onClick={() => onJump(line, column)}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                {summary.kind}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{summary.preview}</span>
                <span className="block text-[10px] text-muted-foreground tabular-nums">
                  Statement {index + 1} · Zeile {line}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
