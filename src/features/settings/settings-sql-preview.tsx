import { useEffect, useMemo, useState } from "react";
import { editorFontStack, editorLineHeightPx } from "@/lib/editor-options";
import { useSettingsStore } from "@/lib/settings";
import { type SqlDialect, sqlDialectLabel } from "@/lib/sql-format-options";
import { formatSqlInWorker } from "@/lib/sql-format-runner";
import { cn } from "@/lib/utils";

const SAMPLE_SQL =
  "select u.id, u.email, count(o.id) as order_count from users u left join orders o on u.id = o.user_id where u.active = true group by u.id, u.email having count(o.id) > 0 order by order_count desc limit 10;";

export function SettingsSqlPreview({ dialect }: { dialect: SqlDialect }) {
  const store = useSettingsStore();
  const [formattedSql, setFormattedSql] = useState(SAMPLE_SQL);

  useEffect(() => {
    let current = true;
    void formatSqlInWorker(SAMPLE_SQL, {
      dialect,
      tabWidth: store.editorTabSize,
      keywordCase: store.editorKeywordCase,
      linesBetweenQueries: store.editorFormatLinesBetweenQueries,
      denseOperators: store.editorFormatDenseOperators,
      newlineBeforeSemicolon: store.editorFormatNewlineBeforeSemicolon,
    })
      .then((result) => {
        if (current) setFormattedSql(result.ok ? result.sql : `${SAMPLE_SQL}\n-- ${result.reason}`);
      })
      .catch((error: unknown) => {
        if (current)
          setFormattedSql(
            `${SAMPLE_SQL}\n-- ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    return () => {
      current = false;
    };
  }, [
    dialect,
    store.editorTabSize,
    store.editorKeywordCase,
    store.editorFormatLinesBetweenQueries,
    store.editorFormatDenseOperators,
    store.editorFormatNewlineBeforeSemicolon,
  ]);

  const lines = useMemo(() => formattedSql.split("\n"), [formattedSql]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-muted/30 shadow-xs">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">SQL-Editor Vorschau</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span>{store.editorFontSize}px</span>
          <span>•</span>
          <span>Tab: {store.editorTabSize}</span>
          <span>•</span>
          <span>{store.editorKeywordCase}</span>
          <span>•</span>
          <span>{sqlDialectLabel(dialect)}</span>
        </div>
      </div>
      <div
        className={cn(
          "p-4 select-text",
          store.editorWordWrap
            ? "whitespace-pre-wrap break-words"
            : "overflow-x-auto whitespace-pre",
        )}
        style={{
          fontFamily: editorFontStack(store.editorFontFamily),
          fontSize: `${store.editorFontSize}px`,
          lineHeight: `${editorLineHeightPx(store.editorFontSize, store.editorLineHeight)}px`,
          fontKerning: store.editorFontLigatures ? undefined : "none",
        }}
      >
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="flex items-start gap-4">
            {store.editorLineNumbers ? (
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
