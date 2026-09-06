import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

import type { ColumnInfo, TableInfo } from "@/lib/db";
import { addSqlFormatAction, monaco } from "@/lib/monaco";
import { lintUnknownTables } from "@/lib/sql-lint";

interface SchemaRegistry {
  schemas: string[];
  tables: TableInfo[];
  columns: ColumnInfo[];
}

interface QueryEditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave?: () => void;
  registry: SchemaRegistry;
  className?: string;
}

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "SCHEMA",
  "DATABASE",
  "SEQUENCE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "RENAME",
  "TO",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "FULL OUTER JOIN",
  "CROSS JOIN",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "ON",
  "USING",
  "AS",
  "DISTINCT",
  "ALL",
  "ANY",
  "SOME",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "INTERSECT",
  "EXCEPT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "WITH",
  "RECURSIVE",
  "RETURNING",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "EXPLAIN",
  "EXPLAIN ANALYZE",
  "OVER",
  "PARTITION BY",
  "WINDOW",
  "ON CONFLICT",
  "DO NOTHING",
  "DO UPDATE",
  "LATERAL",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "NOT NULL",
  "CASCADE",
  "RESTRICT",
  "INTEGER",
  "INT",
  "BIGINT",
  "SMALLINT",
  "SERIAL",
  "BIGSERIAL",
  "TEXT",
  "VARCHAR",
  "CHAR",
  "BOOLEAN",
  "BOOL",
  "FLOAT",
  "REAL",
  "DOUBLE PRECISION",
  "NUMERIC",
  "DECIMAL",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "TIMESTAMP WITH TIME ZONE",
  "INTERVAL",
  "JSON",
  "JSONB",
  "UUID",
  "BYTEA",
  "ARRAY",
  "TRUE",
  "FALSE",
  "NULL",
];

const PG_FUNCTIONS: { name: string; signature: string }[] = [
  { name: "COUNT", signature: "COUNT(expression)" },
  { name: "SUM", signature: "SUM(expression)" },
  { name: "AVG", signature: "AVG(expression)" },
  { name: "MIN", signature: "MIN(expression)" },
  { name: "MAX", signature: "MAX(expression)" },
  { name: "ARRAY_AGG", signature: "ARRAY_AGG(expression)" },
  { name: "STRING_AGG", signature: "STRING_AGG(expression, delimiter)" },
  { name: "JSON_AGG", signature: "JSON_AGG(expression)" },
  { name: "JSONB_AGG", signature: "JSONB_AGG(expression)" },
  { name: "ROW_NUMBER", signature: "ROW_NUMBER()" },
  { name: "RANK", signature: "RANK()" },
  { name: "DENSE_RANK", signature: "DENSE_RANK()" },
  { name: "LAG", signature: "LAG(expression, offset, default)" },
  { name: "LEAD", signature: "LEAD(expression, offset, default)" },
  { name: "FIRST_VALUE", signature: "FIRST_VALUE(expression)" },
  { name: "LAST_VALUE", signature: "LAST_VALUE(expression)" },
  { name: "NTH_VALUE", signature: "NTH_VALUE(expression, n)" },
  { name: "NTILE", signature: "NTILE(n)" },
  { name: "PERCENT_RANK", signature: "PERCENT_RANK()" },
  { name: "CUME_DIST", signature: "CUME_DIST()" },
  { name: "LENGTH", signature: "LENGTH(string)" },
  { name: "LOWER", signature: "LOWER(string)" },
  { name: "UPPER", signature: "UPPER(string)" },
  { name: "TRIM", signature: "TRIM(string)" },
  { name: "LTRIM", signature: "LTRIM(string)" },
  { name: "RTRIM", signature: "RTRIM(string)" },
  { name: "CONCAT", signature: "CONCAT(val1, val2, ...)" },
  { name: "CONCAT_WS", signature: "CONCAT_WS(separator, val1, val2, ...)" },
  {
    name: "SUBSTRING",
    signature: "SUBSTRING(string FROM start FOR length)",
  },
  { name: "SUBSTR", signature: "SUBSTR(string, start, length)" },
  { name: "REPLACE", signature: "REPLACE(string, from, to)" },
  {
    name: "REGEXP_REPLACE",
    signature: "REGEXP_REPLACE(string, pattern, replacement)",
  },
  { name: "REGEXP_MATCH", signature: "REGEXP_MATCH(string, pattern)" },
  { name: "SPLIT_PART", signature: "SPLIT_PART(string, delimiter, n)" },
  { name: "POSITION", signature: "POSITION(substring IN string)" },
  { name: "STRPOS", signature: "STRPOS(string, substring)" },
  { name: "INITCAP", signature: "INITCAP(string)" },
  { name: "REPEAT", signature: "REPEAT(string, n)" },
  { name: "REVERSE", signature: "REVERSE(string)" },
  { name: "LPAD", signature: "LPAD(string, length, fill)" },
  { name: "RPAD", signature: "RPAD(string, length, fill)" },
  { name: "FORMAT", signature: "FORMAT(format, ...)" },
  { name: "STARTS_WITH", signature: "STARTS_WITH(string, prefix)" },
  { name: "ABS", signature: "ABS(x)" },
  { name: "CEIL", signature: "CEIL(x)" },
  { name: "FLOOR", signature: "FLOOR(x)" },
  { name: "ROUND", signature: "ROUND(x, decimal_places)" },
  { name: "TRUNC", signature: "TRUNC(x, decimal_places)" },
  { name: "SIGN", signature: "SIGN(x)" },
  { name: "POWER", signature: "POWER(base, exponent)" },
  { name: "SQRT", signature: "SQRT(x)" },
  { name: "EXP", signature: "EXP(x)" },
  { name: "LN", signature: "LN(x)" },
  { name: "LOG", signature: "LOG(base, x)" },
  { name: "MOD", signature: "MOD(dividend, divisor)" },
  { name: "RANDOM", signature: "RANDOM()" },
  { name: "PI", signature: "PI()" },
  { name: "NOW", signature: "NOW()" },
  { name: "CURRENT_DATE", signature: "CURRENT_DATE" },
  { name: "CURRENT_TIME", signature: "CURRENT_TIME" },
  { name: "CURRENT_TIMESTAMP", signature: "CURRENT_TIMESTAMP" },
  { name: "DATE_PART", signature: "DATE_PART('field', source)" },
  { name: "DATE_TRUNC", signature: "DATE_TRUNC('field', source)" },
  { name: "EXTRACT", signature: "EXTRACT(field FROM source)" },
  { name: "AGE", signature: "AGE(timestamp1, timestamp2)" },
  { name: "TO_DATE", signature: "TO_DATE(string, format)" },
  { name: "TO_TIMESTAMP", signature: "TO_TIMESTAMP(string, format)" },
  { name: "TO_CHAR", signature: "TO_CHAR(value, format)" },
  { name: "MAKE_DATE", signature: "MAKE_DATE(year, month, day)" },
  { name: "CLOCK_TIMESTAMP", signature: "CLOCK_TIMESTAMP()" },
  { name: "TO_JSON", signature: "TO_JSON(value)" },
  { name: "TO_JSONB", signature: "TO_JSONB(value)" },
  { name: "JSON_BUILD_OBJECT", signature: "JSON_BUILD_OBJECT(key, value, ...)" },
  { name: "JSONB_BUILD_OBJECT", signature: "JSONB_BUILD_OBJECT(key, value, ...)" },
  { name: "JSON_BUILD_ARRAY", signature: "JSON_BUILD_ARRAY(...)" },
  { name: "JSONB_BUILD_ARRAY", signature: "JSONB_BUILD_ARRAY(...)" },
  { name: "JSON_OBJECT_KEYS", signature: "JSON_OBJECT_KEYS(json)" },
  { name: "JSONB_OBJECT_KEYS", signature: "JSONB_OBJECT_KEYS(jsonb)" },
  { name: "JSON_ARRAY_ELEMENTS", signature: "JSON_ARRAY_ELEMENTS(json)" },
  { name: "JSONB_ARRAY_ELEMENTS", signature: "JSONB_ARRAY_ELEMENTS(jsonb)" },
  { name: "JSON_EACH", signature: "JSON_EACH(json)" },
  { name: "JSONB_EACH", signature: "JSONB_EACH(jsonb)" },
  { name: "ROW_TO_JSON", signature: "ROW_TO_JSON(record)" },
  { name: "JSONB_PRETTY", signature: "JSONB_PRETTY(jsonb)" },
  { name: "JSONB_STRIP_NULLS", signature: "JSONB_STRIP_NULLS(jsonb)" },
  { name: "UNNEST", signature: "UNNEST(array)" },
  { name: "ARRAY_LENGTH", signature: "ARRAY_LENGTH(array, dimension)" },
  { name: "ARRAY_TO_STRING", signature: "ARRAY_TO_STRING(array, delimiter)" },
  { name: "STRING_TO_ARRAY", signature: "STRING_TO_ARRAY(string, delimiter)" },
  { name: "ARRAY_APPEND", signature: "ARRAY_APPEND(array, element)" },
  { name: "ARRAY_PREPEND", signature: "ARRAY_PREPEND(element, array)" },
  { name: "CAST", signature: "CAST(value AS type)" },
  { name: "COALESCE", signature: "COALESCE(val1, val2, ...)" },
  { name: "NULLIF", signature: "NULLIF(val1, val2)" },
  { name: "GREATEST", signature: "GREATEST(val1, val2, ...)" },
  { name: "LEAST", signature: "LEAST(val1, val2, ...)" },
  { name: "PG_TYPEOF", signature: "PG_TYPEOF(value)" },
  { name: "PG_SIZE_PRETTY", signature: "PG_SIZE_PRETTY(size)" },
  { name: "VERSION", signature: "VERSION()" },
  { name: "GEN_RANDOM_UUID", signature: "GEN_RANDOM_UUID()" },
];

function needsQuoting(name: string): boolean {
  return !/^[a-z_][a-z0-9_]*$/.test(name);
}

function quoteIdent(name: string): string {
  return needsQuoting(name) ? `"${name.replace(/"/g, '""')}"` : name;
}

function analyzeContext(textBeforeCursor: string): "table" | "column" | "general" {
  const withoutCurrentWord = textBeforeCursor.replace(/\w+$/, "");
  const upper = withoutCurrentWord.toUpperCase();

  const tablePatterns = [
    /\bFROM\b\s*(?:[\w".]+\s*,\s*)*$/,
    /\bJOIN\b\s*$/,
    /\bINTO\b\s*$/,
    /\bUPDATE\b\s*$/,
    /\bTABLE\b\s*$/,
    /\bTRUNCATE\b\s*$/,
  ];

  const columnPatterns = [
    /\bSELECT\b\s*(?:.*,\s*)*$/,
    /\bWHERE\b\s*(?:.*(?:\bAND\b|\bOR\b)\s*)*$/,
    /\bSET\b\s*(?:.*,\s*)*$/,
    /\bHAVING\b\s*(?:.*(?:\bAND\b|\bOR\b)\s*)*$/,
    /\bON\b\s*$/,
    /\bRETURNING\b\s*(?:.*,\s*)*$/,
    /\bBY\b\s*(?:.*,\s*)*$/,
    /\bAND\b\s*$/,
    /\bOR\b\s*$/,
  ];

  if (tablePatterns.some((p) => p.test(upper))) return "table";
  if (columnPatterns.some((p) => p.test(upper))) return "column";
  return "general";
}

function extractReferencedTableNames(textBeforeCursor: string, tables: TableInfo[]): string[] {
  const result: string[] = [];
  const pattern = /(?:FROM|JOIN)\s+([\w"]+(?:\.[\w"]+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(textBeforeCursor)) !== null) {
    const ref = match[1].replace(/"/g, "");
    if (ref.includes(".")) {
      const [, tablePart] = ref.split(".");
      result.push(tablePart);
    } else {
      result.push(ref);
    }
  }
  const aliasPattern = /(?:FROM|JOIN)\s+[\w"]+(?:\.[\w"]+)?(?:\s+(?:AS\s+)?(\w+))?/gi;
  while ((match = aliasPattern.exec(textBeforeCursor)) !== null) {
    if (match[1]) {
      const alias = match[1];
      const tableRef = match[0]
        .replace(/(?:FROM|JOIN)\s+/i, "")
        .split(/\s+/)[0]
        .replace(/"/g, "");
      const tablePart = tableRef.includes(".") ? tableRef.split(".")[1] : tableRef;
      const found = tables.find((t) => t.name.toLowerCase() === tablePart.toLowerCase());
      if (found) result.push(alias);
    }
  }
  return [...new Set(result)];
}

function buildCompletions(
  registry: SchemaRegistry,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionList {
  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  const lineContent = model.getLineContent(position.lineNumber);
  const lineBeforeCursor = lineContent.slice(0, position.column - 1);
  const textBeforeCursor = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const suggestions: monaco.languages.CompletionItem[] = [];

  const dotMatch = lineBeforeCursor.match(/(\w+)\.\s*$/);
  if (dotMatch) {
    const qualifier = dotMatch[1];
    const dotOffset = lineBeforeCursor.lastIndexOf(".");
    const dotRange: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: dotOffset + 2,
      endColumn: position.column,
    };

    const isSchema = registry.schemas.some((s) => s.toLowerCase() === qualifier.toLowerCase());

    if (isSchema) {
      for (const table of registry.tables) {
        if (table.schema.toLowerCase() === qualifier.toLowerCase()) {
          suggestions.push({
            label: table.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `table · ${table.schema}`,
            insertText: quoteIdent(table.name),
            range: dotRange,
            sortText: `0_${table.name}`,
          });
        }
      }
    } else {
      const aliasMap = new Map<string, string>();
      const aliasPattern = /(?:FROM|JOIN)\s+([\w"]+(?:\.[\w"]+)?)(?:\s+(?:AS\s+)?(\w+))?/gi;
      let am: RegExpExecArray | null;
      while ((am = aliasPattern.exec(textBeforeCursor)) !== null) {
        if (am[2]) {
          const tableRef = am[1].replace(/"/g, "");
          const tablePart = tableRef.includes(".") ? tableRef.split(".")[1] : tableRef;
          aliasMap.set(am[2].toLowerCase(), tablePart);
        }
      }
      const resolvedTable = aliasMap.get(qualifier.toLowerCase()) ?? qualifier;

      const matchingColumns = registry.columns.filter(
        (c) => c.table.toLowerCase() === resolvedTable.toLowerCase(),
      );

      for (const col of matchingColumns) {
        suggestions.push({
          label: col.name,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: col.data_type,
          insertText: quoteIdent(col.name),
          range: dotRange,
          sortText: `0_${col.name}`,
        });
      }

      if (matchingColumns.length === 0) {
        const matchedTable = registry.tables.find(
          (t) => t.name.toLowerCase() === qualifier.toLowerCase(),
        );
        if (matchedTable) {
          for (const col of registry.columns) {
            if (
              col.table.toLowerCase() === matchedTable.name.toLowerCase() &&
              col.schema.toLowerCase() === matchedTable.schema.toLowerCase()
            ) {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: col.data_type,
                insertText: quoteIdent(col.name),
                range: dotRange,
                sortText: `0_${col.name}`,
              });
            }
          }
        }
      }
    }

    return { suggestions };
  }

  const context = analyzeContext(textBeforeCursor);

  if (context === "table") {
    for (const schema of registry.schemas) {
      suggestions.push({
        label: schema,
        kind: monaco.languages.CompletionItemKind.Module,
        detail: "schema",
        insertText: quoteIdent(schema),
        range,
        sortText: `0_${schema}`,
      });
    }
    for (const table of registry.tables) {
      suggestions.push({
        label: `${table.schema}.${table.name}`,
        kind: monaco.languages.CompletionItemKind.Class,
        detail: "table",
        insertText: `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`,
        range,
        sortText: `1_${table.schema}_${table.name}`,
      });
      suggestions.push({
        label: table.name,
        kind: monaco.languages.CompletionItemKind.Class,
        detail: `table · ${table.schema}`,
        insertText: quoteIdent(table.name),
        range,
        sortText: `2_${table.name}`,
      });
    }
  } else {
    const referencedNames = extractReferencedTableNames(textBeforeCursor, registry.tables);
    const hasReferenced = referencedNames.length > 0;

    for (const col of registry.columns) {
      const isReferenced = hasReferenced
        ? referencedNames.some((n) => n.toLowerCase() === col.table.toLowerCase())
        : false;
      suggestions.push({
        label: col.name,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: `${col.data_type} · ${col.schema}.${col.table}`,
        insertText: quoteIdent(col.name),
        range,
        sortText: isReferenced ? `0_${col.name}` : `3_${col.name}`,
      });
    }

    for (const table of registry.tables) {
      suggestions.push({
        label: table.name,
        kind: monaco.languages.CompletionItemKind.Class,
        detail: `table · ${table.schema}`,
        insertText: quoteIdent(table.name),
        range,
        sortText: `1_${table.name}`,
      });
    }

    for (const schema of registry.schemas) {
      suggestions.push({
        label: schema,
        kind: monaco.languages.CompletionItemKind.Module,
        detail: "schema",
        insertText: quoteIdent(schema),
        range,
        sortText: `2_${schema}`,
      });
    }
  }

  for (const kw of SQL_KEYWORDS) {
    suggestions.push({
      label: kw,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: kw,
      range,
      sortText: `4_${kw}`,
    });
  }

  for (const fn of PG_FUNCTIONS) {
    suggestions.push({
      label: fn.name,
      kind: monaco.languages.CompletionItemKind.Function,
      detail: fn.signature,
      insertText: `${fn.name}($0)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: `5_${fn.name}`,
    });
  }

  return { suggestions };
}

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

function refreshLintMarkers(editor: monaco.editor.IStandaloneCodeEditor, registry: SchemaRegistry) {
  const model = editor.getModel();
  if (!model) return;
  const findings = lintUnknownTables(model.getValue(), registry.tables);
  monaco.editor.setModelMarkers(
    model,
    "l8db-sql-lint",
    findings.map((finding) => {
      const start = model.getPositionAt(finding.offset);
      const end = model.getPositionAt(finding.offset + finding.length);
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: finding.message,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      };
    }),
  );
}

export function QueryEditorPane({
  value,
  onChange,
  onRun,
  onSave,
  registry,
  className,
}: QueryEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const registryRef = useRef(registry);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onSaveRef.current = onSave;
  registryRef.current = registry;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: themeFor(resolvedTheme),
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      lineHeight: 24,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      padding: { top: 16, bottom: 16 },
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      tabSize: 2,
      fixedOverflowWidgets: true,
      suggestOnTriggerCharacters: true,
      quickSuggestions: {
        other: true,
        comments: false,
        strings: false,
      },
      parameterHints: { enabled: true },
      acceptSuggestionOnEnter: "on",
    });

    editorRef.current = editor;
    refreshLintMarkers(editor, registryRef.current);

    let lintTimer: ReturnType<typeof setTimeout> | null = null;
    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
      if (lintTimer) clearTimeout(lintTimer);
      lintTimer = setTimeout(() => {
        const current = editorRef.current;
        if (current) refreshLintMarkers(current, registryRef.current);
      }, 500);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    const formatAction = addSqlFormatAction(editor);

    const completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: ["."],
      provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
        return buildCompletions(registryRef.current, model, position);
      },
    });

    return () => {
      if (lintTimer) clearTimeout(lintTimer);
      changeSub.dispose();
      completionProvider.dispose();
      formatAction.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) refreshLintMarkers(editor, registry);
  }, [registry]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  return <div ref={containerRef} className={className ?? "size-full"} />;
}
