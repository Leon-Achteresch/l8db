import { useMemo } from "react";
import { useActiveConnection } from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import {
  formatSqlWith,
  sqlDialectForKind,
  sqlDialectLabel,
  supportsSqlFormatting,
} from "@/lib/sql-format";
import { cn } from "@/lib/utils";

const SAMPLE_SQL =
  "select u.id, u.email, count(o.id) as order_count from users u left join orders o on u.id = o.user_id where u.active = true group by u.id, u.email having count(o.id) > 0 order by order_count desc limit 10;";

export function SettingsSqlPreview() {
  const {
    editorFontSize,
    editorTabSize,
    editorKeywordCase,
    editorLineNumbers,
    editorWordWrap,
  } = useSettingsStore();

  const connection = useActiveConnection();
  const dialect = sqlDialectForKind(connection?.kind);
  const formattingAvailable = connection
    ? supportsSqlFormatting(capabilitiesFor(connection.kind).query_language)
    : true;

  const formattedSql = useMemo(() => {
    const result = formatSqlWith(SAMPLE_SQL, {
      dialect,
      tabWidth: editorTabSize,
      keywordCase: editorKeywordCase,
    });
    return result.ok ? result.sql : `${SAMPLE_SQL}\n-- ${result.reason}`;
  }, [dialect, editorTabSize, editorKeywordCase]);

  const lines = useMemo(() => formattedSql.split("\n"), [formattedSql]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-muted/30 shadow-xs">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {formattingAvailable
            ? "SQL-Editor Vorschau"
            : "SQL-Editor Vorschau (Provider ohne SQL-Formatierung)"}
        </span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span>{editorFontSize}px</span>
          <span>•</span>
          <span>Tab: {editorTabSize}</span>
          <span>•</span>
          <span>{editorKeywordCase}</span>
          <span>•</span>
          <span>{sqlDialectLabel(dialect)}</span>
        </div>
      </div>
      <div
        className={cn(
          "p-4 font-mono select-text",
          editorWordWrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
        )}
        style={{
          fontSize: `${editorFontSize}px`,
          lineHeight: `${Math.round(editorFontSize * 1.7)}px`,
        }}
      >
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="flex items-start gap-4">
            {editorLineNumbers ? (
              <span className="w-5 shrink-0 select-none text-right text-xs text-muted-foreground/40">
                {index + 1}
              </span>
            ) : null}
            <span className="flex-1 text-foreground/90">{line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
