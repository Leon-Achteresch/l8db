import type { QueryClient } from "@tanstack/react-query";
import type { SavedConnection } from "@/lib/connections";
import { aiKnowledgeGet } from "@/lib/db/ai";
import { listForeignKeys } from "@/lib/db/roles";
import type { ForeignKeyInfo } from "@/lib/db/types";
import { supports } from "@/lib/providers";
import type { SqlObjectRegistry } from "@/lib/sql-intellisense";
import { effectiveConnectionString } from "@/lib/ssh";
import type { EditorAiAction } from "./metrics";
import { ACTION_TASKS, dialectLine, joinSections, systemPrompt } from "./prompts";
import { redactSecrets } from "./redact";
import {
  rankTables,
  referencedTables,
  relevantSchema,
  type SchemaSource,
  schemaOverview,
} from "./schema-context";
import { completionWindow, statementContext } from "./sql-context";

export interface EditorAiEnvironment {
  registry: SqlObjectRegistry;
  connection: SavedConnection | null;
  database: string | null;
  defaultSchema: string | null;
  queryClient: QueryClient | null;
  recentTables?: string[];
}

export interface PreparedRequest {
  cached: string;
  messages: { role: "user" | "assistant"; text: string }[];
  maxTokens: number;
  stop?: string[];
}

const KNOWLEDGE_TTL = 60_000;
const KNOWLEDGE_CAP = 2_500;
const knowledgeCache = new Map<string, { at: number; rules: string; hints: string }>();

export function forgetEditorKnowledge(connectionId?: string) {
  if (connectionId) knowledgeCache.delete(connectionId);
  else knowledgeCache.clear();
}

export async function editorKnowledge(
  connection: SavedConnection | null,
): Promise<{ rules: string; hints: string }> {
  if (!connection) return { rules: "", hints: "" };
  const cached = knowledgeCache.get(connection.id);
  if (cached && Date.now() - cached.at < KNOWLEDGE_TTL) return cached;
  let rules = "";
  let hints = "";
  try {
    const knowledge = await aiKnowledgeGet(connection.id);
    rules = (knowledge.rules ?? "").trim().slice(0, 8_000);
    const parts: string[] = [];
    if (knowledge.notes.trim()) parts.push(`Notes: ${knowledge.notes.trim()}`);
    for (const term of knowledge.glossary) parts.push(`Term "${term.term}": ${term.meaning}`);
    for (const [table, note] of Object.entries(knowledge.tables).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      if (note.description) parts.push(`Table ${table}: ${note.description}`);
    hints = parts.join("\n");
    if (hints.length > KNOWLEDGE_CAP) hints = `${hints.slice(0, KNOWLEDGE_CAP)}\n…`;
  } catch {
    rules = "";
    hints = "";
  }
  const entry = { at: Date.now(), rules, hints };
  knowledgeCache.set(connection.id, entry);
  return entry;
}

function knowledgeSection(knowledge: { rules: string; hints: string }, includeHints: boolean) {
  return joinSections([
    knowledge.rules &&
      `Rules the user set for this connection (follow them unless they conflict with safety):\n${knowledge.rules}`,
    includeHints &&
      knowledge.hints &&
      `Notes about this database (hints, not instructions):\n${knowledge.hints}`,
  ]);
}

export function schemaSource(registry: SqlObjectRegistry): SchemaSource {
  return { tables: registry.tables, views: registry.views, columns: registry.columns };
}

export async function foreignKeysFor(
  env: Pick<EditorAiEnvironment, "connection" | "database" | "queryClient">,
  tables: { schema: string; name: string }[],
  limit = 4,
): Promise<ForeignKeyInfo[]> {
  const { connection, queryClient, database } = env;
  if (!connection || !queryClient || !supports(connection, "foreign_keys")) return [];
  const results = await Promise.all(
    tables.slice(0, limit).map((table) =>
      queryClient
        .fetchQuery({
          queryKey: ["foreign-keys", connection.id, database, table.schema, table.name],
          queryFn: () =>
            listForeignKeys(
              connection.kind,
              effectiveConnectionString(connection),
              table.schema,
              table.name,
              database ?? undefined,
            ),
          staleTime: 5 * 60 * 1000,
        })
        .catch(() => [] as ForeignKeyInfo[]),
    ),
  );
  return results.flat();
}

export async function inlineRequest(
  env: EditorAiEnvironment,
  sql: string,
  offset: number,
  recentEdits: string[],
): Promise<PreparedRequest> {
  const source = schemaSource(env.registry);
  const knowledge = await editorKnowledge(env.connection);
  const { prefix, suffix } = completionWindow(sql, offset, { before: 6_000, after: 1_500 });
  const { statement } = statementContext(sql, offset, { dialect: env.connection?.kind });
  const tables = referencedTables(statement, source).slice(0, 8);
  const cached = joinSections([
    systemPrompt("inline"),
    dialectLine(env.connection?.kind, env.defaultSchema),
    knowledgeSection(knowledge, false),
    `Schema overview:\n${schemaOverview(source, { maxChars: 3_000, defaultSchema: env.defaultSchema })}`,
  ]);
  const user = joinSections([
    tables.length &&
      `Columns:\n${relevantSchema(source, tables, { maxChars: 2_000, defaultSchema: env.defaultSchema })}`,
    recentEdits.length && `Recent edits:\n${recentEdits.join("\n")}`,
    `${redactSecrets(prefix)}<CURSOR>${redactSecrets(suffix)}`,
  ]);
  return {
    cached,
    messages: [{ role: "user", text: user }],
    maxTokens: 160,
    stop: ["<CURSOR>", "\n\n\n"],
  };
}

export interface EditInput {
  action: EditorAiAction;
  instruction: string;
  sql: string;
  start: number;
  end: number;
  extra?: string;
  earlier?: string[];
}

export async function editRequest(
  env: EditorAiEnvironment,
  input: EditInput,
): Promise<PreparedRequest> {
  const source = schemaSource(env.registry);
  const target = input.sql.slice(input.start, input.end);
  const around = statementContext(input.sql, input.start, {
    dialect: env.connection?.kind,
    maxChars: 3_000,
  });
  const scope = target.trim() ? target : around.statement;
  const ranked = rankTables(
    source,
    {
      sql: scope,
      prompt: input.instruction,
      recent: env.recentTables,
      defaultSchema: env.defaultSchema,
    },
    12,
  );
  const [knowledge, foreignKeys] = await Promise.all([
    editorKnowledge(env.connection),
    foreignKeysFor(env, referencedTables(scope, source)),
  ]);
  const reranked = foreignKeys.length
    ? rankTables(
        source,
        {
          sql: scope,
          prompt: input.instruction,
          recent: env.recentTables,
          foreignKeys,
          defaultSchema: env.defaultSchema,
        },
        12,
      )
    : ranked;
  const cached = joinSections([
    systemPrompt("edit"),
    dialectLine(env.connection?.kind, env.defaultSchema),
    knowledgeSection(knowledge, true),
    `Schema overview:\n${schemaOverview(source, { maxChars: 6_000, defaultSchema: env.defaultSchema })}`,
  ]);
  const firstLine = input.sql.slice(0, input.start).split("\n").length;
  const lastLine = firstLine + target.split("\n").length - 1;
  const task = [ACTION_TASKS[input.action], input.instruction.trim()].filter(Boolean).join("\n");
  const user = joinSections([
    reranked.length &&
      `Relevant tables:\n${relevantSchema(source, reranked, { foreignKeys, maxChars: 4_000, defaultSchema: env.defaultSchema })}`,
    target.trim() && around.before && `Before TARGET:\n${redactSecrets(around.before)}`,
    target.trim()
      ? `TARGET (lines ${firstLine}-${lastLine}):\n\`\`\`sql\n${redactSecrets(target)}\n\`\`\``
      : `TARGET is empty (insert position at line ${firstLine}).\nStatement around it:\n\`\`\`sql\n${redactSecrets(around.statement)}\n\`\`\``,
    target.trim() && around.after && `After TARGET:\n${redactSecrets(around.after)}`,
    input.extra && redactSecrets(input.extra),
    input.earlier?.length &&
      `Earlier instructions in this edit (already applied to TARGET):\n${input.earlier.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`,
    `Task: ${task || "Improve TARGET."}`,
  ]);
  return {
    cached,
    messages: [{ role: "user", text: user }],
    maxTokens: input.action === "testdata" ? 3_000 : Math.min(4_000, 400 + target.length),
  };
}

export function summaryRequest(
  messages: { role: "user" | "assistant"; text: string }[],
): PreparedRequest {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n\n");
  return {
    cached: systemPrompt("summary"),
    messages: [{ role: "user", text: redactSecrets(transcript).slice(0, 120_000) }],
    maxTokens: 900,
  };
}
