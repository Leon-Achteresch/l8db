import { lstat, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ScriptRunEntry,
  ScriptRunMessage,
  ScriptRunStatus,
} from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import type { SavedConnection } from "@/lib/connections";
import {
  cancelExecution,
  confirmSqlExecution,
  executeInTransaction,
  executeQuery,
  executeWithBinds,
  listTableColumnsDetailed,
  type QueryResult,
  takeServerOutput,
  transactionServerOutput,
} from "@/lib/db";
import { sqlSearchPath } from "@/lib/db/sql-include";
import {
  confirmProductionCommit,
  ensureManagedTransaction,
  finishManagedTransaction,
  runManagedOperation,
} from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { useQueryHistoryStore } from "@/lib/query-history";
import { applySelectRowLimit } from "@/lib/select-row-limit";
import {
  deliverServerOutput,
  isServerOutputEnabled,
  toggleServerOutput,
  useServerOutputStore,
} from "@/lib/server-output";
import { expandSessionViews, runSessionViewStatement, sessionViewsFor } from "@/lib/session-views";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { readSqlText } from "@/lib/sql-file";
import { scriptPolicyIssue } from "@/lib/sql-safety";
import { isTransactionalStatement, splitSqlStatements } from "@/lib/sql-statements";
import { expandIncludes, type ScriptItem, scriptItems } from "@/lib/sql-statements/includes";
import {
  type AskVariables,
  applySqlPlusSetting,
  askMissingVariables,
  bindNames,
  createSubstitutionState,
  type ExitAction,
  type ExitStatus,
  oracleObjectName,
  PREDEFINED_VARIABLES,
  parseSqlPlusCommand,
  type SqlPlusCommand,
  SUBSTITUTED_COMMANDS,
  type SubstitutionSession,
  substitute,
} from "@/lib/sql-statements/sqlplus";
import {
  compileWarning,
  leadingWords,
  scriptTranscript,
  sqlplusFeedback,
} from "@/lib/sqlplus-output";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import {
  executeWithTransactionChanges,
  refreshDatabaseChanges,
} from "@/lib/transaction-sql-changes";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

const CONNECT_UNSUPPORTED =
  "CONNECT/DISCONNECT wird nicht unterstützt. Das Skript wurde angehalten, damit die folgenden Statements nicht im falschen Schema laufen.";
const HOST_UNSUPPORTED =
  "HOST führt Betriebssystembefehle aus und wird aus Sicherheitsgründen nicht ausgeführt. Das Skript wurde angehalten.";
const DISPLAY_NOTE =
  "Darstellungsoption ohne Wirkung: l8db zeigt Ergebnisse als Raster und Statements, Meldungen und Zeiten immer an.";
const IMPLICIT_COMMIT = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "RENAME",
  "COMMENT",
  "ANALYZE",
  "AUDIT",
  "NOAUDIT",
  "PURGE",
  "FLASHBACK",
]);
const BIND_TYPE =
  /^(NUMBER|BINARY_FLOAT|BINARY_DOUBLE|CLOB|NCLOB|REFCURSOR|BOOLEAN|(N?CHAR|N?VARCHAR2)(\s*\(\s*\d+(\s+(CHAR|BYTE))?\s*\))?)$/;
const MAX_SCRIPT_OUTPUT = 20_000;
const OUTPUT_BATCH = 2000;
const OUTPUT_ROUNDS = MAX_SCRIPT_OUTPUT / OUTPUT_BATCH;
const SPOOL_EXTENSIONS = new Set(["lst", "log", "txt", "out"]);

export interface ScriptRequest {
  connection: SavedConnection;
  database: string | null;
  sql: string;
  mode: ScriptRunMode;
  stopOnError?: boolean;
  selectRowLimit?: number;
  filePath?: string | null;
  variables?: SubstitutionSession;
  askVariables?: AskVariables;
  title?: string;
  onJob?: (id: string) => void;
  onProgress?: (entries: ScriptRunEntry[]) => void;
}

export interface ScriptExit {
  code: number;
  label: string;
  action: ExitAction;
}

export interface ScriptOutcome {
  entries: ScriptRunEntry[];
  lastResult: QueryResult | null;
  error: string | null;
  txId: string | null;
  exit: ScriptExit | null;
}

interface WheneverRule {
  exit: boolean;
  status: ExitStatus;
  action: ExitAction | "NONE" | null;
}

interface BindState {
  dataType: string;
  value: string | null;
  cursor: QueryResult | null;
}

class ScriptAbort extends Error {}

function abort(failure: unknown): never {
  throw new ScriptAbort(failure instanceof Error ? failure.message : String(failure));
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function first(result: QueryResult): string {
  return String(Object.values(result.rows[0] ?? {})[0] ?? "");
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function connectIdentifier(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const alias = url.searchParams.get("tns") ?? url.searchParams.get("connect_string");
    if (alias) return alias;
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${decodeURIComponent(url.pathname)}`;
  } catch {
    return "";
  }
}

function dirname(path: string): string | null {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? null : path.slice(0, index) || path.slice(0, 1);
}

function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor(total / 6000) % 60;
  const seconds = Math.floor(total / 100) % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(total % 100)}`;
}

function verifyLines(before: string, after: string): ScriptRunMessage[] {
  const old = before.split("\n");
  const next = after.split("\n");
  const lines: ScriptRunMessage[] = [];
  old.forEach((line, index) => {
    if (line === next[index]) return;
    const number = String(index + 1).padStart(4);
    lines.push({ level: "INFO", message: `alt ${number}: ${line}` });
    lines.push({ level: "INFO", message: `neu ${number}: ${next[index] ?? ""}` });
  });
  return lines;
}

function createdObject(sql: string): { type: string; owner: string | null; name: string } | null {
  const match =
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?(PACKAGE\s+BODY|TYPE\s+BODY|JAVA\s+SOURCE|PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE|VIEW|LIBRARY)\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)/i.exec(
      sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, ""),
    );
  if (!match) return null;
  const target = oracleObjectName(match[2].replace(/\s+/g, ""));
  if (!target) return null;
  return {
    type: match[1].toUpperCase().replace(/\s+/g, " "),
    owner: target.schema,
    name: target.object,
  };
}

export async function runSqlScript(request: ScriptRequest): Promise<ScriptOutcome> {
  const { connection, database, mode } = request;
  const url = effectiveConnectionString(connection);
  const oracle = connection.kind === "oracle";
  const split = splitSqlStatements(request.sql, connection.kind, { slashRuns: oracle });
  if (split.unterminated)
    throw new Error(
      "Nicht abgeschlossenes SQL-Literal oder Kommentar. Das Skript wurde nicht gestartet.",
    );
  const items = split.commands.length
    ? await expandIncludes(scriptItems(split), {
        file: request.filePath ?? null,
        searchPath: await sqlSearchPath().catch(() => []),
        stat: (path) =>
          stat(path).then(
            (info) => ({ size: info.size }),
            () => null,
          ),
        read: readSqlText,
      })
    : scriptItems(split);
  const shown = items.filter(
    (item) => item.kind !== "command" || parseSqlPlusCommand(item.text).type !== "remark",
  );
  if (!shown.length) throw new Error("Das Skript enthält keine ausführbaren Statements.");
  const session = request.variables ?? { state: createSubstitutionState(), answers: {} };
  const answers = oracle ? await askMissingVariables(items, session, request.askVariables) : {};
  if (!answers) throw new Error("Ausführung vom Benutzer abgebrochen.");
  let values: Record<string, string> = answers;
  const hidden = new Set(
    items.flatMap((item) => {
      if (item.kind !== "command") return [];
      const command = parseSqlPlusCommand(item.text);
      return command.type === "accept" && command.hide ? [command.name] : [];
    }),
  );
  const masks = Object.fromEntries([...hidden].map((name) => [name, "********"]));
  const mask = (text: string): string | null =>
    hidden.size
      ? substitute(
          text,
          { ...session.state, defines: { ...session.state.defines, ...masks } },
          { ...values, ...masks },
        ).text
      : null;
  const forget = () => {
    for (const name of hidden) delete session.state.defines[name];
  };
  const preview = { ...session.state, defines: { ...session.state.defines } };
  const previewed = new Map<ScriptItem, string>();
  const executable = oracle
    ? items
        .flatMap((item) => {
          Object.assign(preview.defines, item.defines);
          if (item.kind === "command") applySqlPlusSetting(parseSqlPlusCommand(item.text), preview);
          if (item.kind !== "sql") return [];
          const text = substitute(item.text, preview, answers).text;
          previewed.set(item, text);
          return [text];
        })
        .join("\n/\n")
    : request.sql;
  const policyIssue = scriptPolicyIssue(executable, connection.kind, mode !== "autocommit");
  if (policyIssue) throw new Error(policyIssue);
  await confirmSqlExecution(connection.kind, url, executable, database ?? undefined);
  const existing = getQueryTransaction(connection.id, database);
  if (existing && mode !== "existing-transaction")
    throw new Error(
      "Für dieses Ziel besteht bereits eine Transaktion. Bitte diese verwenden oder zuerst abschließen.",
    );
  if (!existing && mode === "existing-transaction")
    throw new Error("Die ausgewählte Transaktion ist nicht mehr offen.");
  if (mode !== "autocommit" && !supports(connection, "transactions"))
    throw new Error("Dieser Provider unterstützt keine Skript-Transaktionen.");

  const entryOf = new Map<ScriptItem, ScriptRunEntry>();
  const entries: ScriptRunEntry[] = shown.map((item, index) => {
    const entry: ScriptRunEntry = {
      index,
      sql: item.text,
      start: item.start,
      end: item.end,
      status: "pending",
      durationMs: null,
      rowCount: null,
      rowsAffected: null,
      error: null,
      ...(item.source ? { source: item.source } : {}),
    };
    entryOf.set(item, entry);
    return entry;
  });
  let stopped = false;
  let currentJob: string | null = null;
  const jobId = startTask(
    {
      title: request.title ?? "SQL-Skript",
      connectionId: connection.id,
      connectionName: connection.name,
      database,
      total: entries.length,
    },
    async () => {
      stopped = true;
      if (currentJob && supports(connection, "query_cancel")) return cancelExecution(currentJob);
      updateTask(jobId, {
        detail: "Das aktuelle Statement wird zu Ende geführt; danach stoppt das Skript.",
      });
      return true;
    },
  );
  request.onJob?.(jobId);
  let txId = existing?.txId ?? null;
  let error: string | null = null;
  let lastResult: QueryResult | null = null;
  let exit: ScriptExit | null = null;
  const stopOnError = request.stopOnError !== false;
  const internal = { confirmed: true, track: false, session: jobId };
  const plus = {
    serverOutput: isServerOutputEnabled(connection.id),
    verify: true,
    autoprint: false,
    autocommit: 0,
    uncommitted: 0,
    exitCommit: true,
    sqlError: null as WheneverRule | null,
    osError: null as WheneverRule | null,
    sqlcode: 0,
    binds: new Map<string, BindState>(),
    columns: new Map<string, { newValue: string | null; oldValue: string | null }>(),
    timers: [] as { name: string | null; started: number }[],
    spool: null as { path: string; mode: "CREATE" | "REPLACE" | "APPEND"; from: number } | null,
    lastObject: null as { type: string; owner: string | null; name: string } | null,
  };
  try {
    if (mode === "new-transaction") {
      txId = (await ensureManagedTransaction(connection, database, { type: "query" })).txId;
      useTransactionStore.getState().setPanelOpen(true);
    }
    const quietTx = oracle && txId && !plus.serverOutput ? txId : null;
    if (quietTx)
      await runManagedOperation(quietTx, () =>
        executeInTransaction(quietTx, "BEGIN DBMS_OUTPUT.DISABLE; END;", internal),
      );
    const earlier = mode === "new-transaction" || quietTx ? null : txId;
    const leftovers = await (earlier
      ? transactionServerOutput(earlier)
      : mode === "autocommit" && supports(connection, "server_output")
        ? takeServerOutput(connection.kind, url, database ?? undefined)
        : Promise.resolve([])
    ).catch(() => []);
    if (leftovers.length) deliverServerOutput(connection.id, database, leftovers);
    const publish = () => request.onProgress?.(entries.map((entry) => ({ ...entry })));
    let halted = false;
    let outputLines = 0;
    let lastSql: ScriptItem | null = null;
    const add = (entry: ScriptRunEntry, lines: ScriptRunMessage[]) => {
      entry.output = [...(entry.output ?? []), ...lines];
    };
    const say = (entry: ScriptRunEntry, level: string, text: string) =>
      add(entry, [{ level, message: text }]);
    const query = (sql: string): Promise<QueryResult> => {
      const active = txId;
      return active
        ? runManagedOperation(active, () => executeInTransaction(active, sql, internal))
        : executeQuery(connection.kind, url, sql, database ?? undefined, internal);
    };
    const collect = async (entry: ScriptRunEntry) => {
      const active = txId;
      const messages: ScriptRunMessage[] = [];
      const read = () =>
        active
          ? transactionServerOutput(active)
          : takeServerOutput(connection.kind, url, database ?? undefined);
      if (active ? oracle && !plus.serverOutput : !supports(connection, "server_output")) return;
      try {
        for (let round = 0; round < OUTPUT_ROUNDS; round += 1) {
          const batch = await read();
          messages.push(...batch);
          if (!oracle || batch.filter((line) => line.level === "OUTPUT").length < OUTPUT_BATCH)
            break;
        }
      } catch {
        if (!messages.length) return;
      }
      if (!messages.length) return;
      const room = Math.max(0, MAX_SCRIPT_OUTPUT - outputLines);
      outputLines += messages.length;
      if (room) add(entry, messages.slice(0, room));
      if (messages.length > room && outputLines - messages.length <= MAX_SCRIPT_OUTPUT)
        say(
          entry,
          "WARNING",
          `Weitere Ausgabe verworfen: höchstens ${MAX_SCRIPT_OUTPUT} Zeilen pro Skriptlauf. Die Server-Ausgabe zeigt die neuesten Zeilen.`,
        );
      if (isServerOutputEnabled(connection.id))
        useServerOutputStore.getState().append(connection.id, database, messages);
    };
    const pendingTransaction = async (): Promise<boolean> =>
      Boolean(first(await query("SELECT DBMS_TRANSACTION.LOCAL_TRANSACTION_ID FROM dual")));
    const settle = async () => {
      const active = txId;
      if (!active) return;
      if (
        !useTransactionStore.getState().transactions.find((tx) => tx.txId === active)?.changes
          .length
      )
        return;
      if (!(await pendingTransaction().catch(() => true)))
        useTransactionStore.getState().clearChanges(active);
    };
    const confirmCommit = async (active: string, always: boolean) => {
      const changes =
        useTransactionStore.getState().transactions.find((item) => item.txId === active)?.changes ??
        [];
      if (always || changes.length)
        await confirmProductionCommit(connection.id, database, changes).catch(abort);
    };
    const control = async (entry: ScriptRunEntry, action: ExitAction, sql: string = action) => {
      const active = txId;
      if (!active) {
        if (oracle && action === "ROLLBACK")
          say(
            entry,
            "WARNING",
            "Autocommit: ROLLBACK ohne Wirkung, die bisherigen Statements sind bereits festgeschrieben.",
          );
        return;
      }
      if (action === "COMMIT") await confirmCommit(active, true);
      await runManagedOperation(active, () => executeInTransaction(active, sql, internal));
      useTransactionStore.getState().clearChanges(active);
      plus.uncommitted = 0;
    };
    const resolveStatus = (status: ExitStatus): { code: number; label: string } => {
      if (status.kind === "code") return { code: status.value, label: status.label };
      if (status.kind === "bind") {
        const value = Number(plus.binds.get(status.name)?.value);
        return { code: Number.isFinite(value) ? value : 1, label: `:${status.name}` };
      }
      if (status.name === "SQL.SQLCODE") return { code: plus.sqlcode, label: status.name };
      if (status.name === "SQL.OSCODE") return { code: 0, label: status.name };
      const value = Number(session.state.defines[status.name]);
      return { code: Number.isFinite(value) ? value : 1, label: status.name };
    };
    const flushSpool = async (entry: ScriptRunEntry, upTo: number) => {
      const spool = plus.spool;
      if (!spool) return;
      plus.spool = null;
      const text = scriptTranscript(entries.slice(spool.from, upTo));
      try {
        await writeTextFile(spool.path, text, {
          append: spool.mode === "APPEND",
          createNew: spool.mode === "CREATE",
        });
        say(entry, "INFO", `Spool geschrieben: ${spool.path}`);
      } catch (failure) {
        throw new Error(`SPOOL ${spool.path} konnte nicht geschrieben werden: ${message(failure)}`);
      }
    };
    const exitScript = async (
      entry: ScriptRunEntry,
      status: ExitStatus,
      action: ExitAction | null,
    ) => {
      halted = true;
      const resolved = resolveStatus(status);
      const chosen: ExitAction = action ?? (plus.exitCommit ? "COMMIT" : "ROLLBACK");
      const active = txId;
      if (active) {
        await finishManagedTransaction(active, chosen === "COMMIT").catch((failure: unknown) =>
          /abgebrochen/.test(message(failure)) ? abort(failure) : Promise.reject(failure),
        );
        txId = null;
      }
      exit = { ...resolved, action: chosen };
      say(entry, "INFO", `EXIT ${resolved.label} (Code ${resolved.code}) mit ${chosen}`);
      if (!active && oracle && chosen === "ROLLBACK")
        say(
          entry,
          "WARNING",
          "Autocommit: ROLLBACK ohne Wirkung, die bisherigen Statements sind bereits festgeschrieben.",
        );
      await flushSpool(entry, entry.index + 1);
    };
    const onRule = async (entry: ScriptRunEntry, rule: WheneverRule | null, failure: string) => {
      error = failure;
      if (!rule) {
        if (stopOnError || (txId && !oracle)) halted = true;
        return;
      }
      if (rule.exit)
        await exitScript(entry, rule.status, rule.action === "NONE" ? null : rule.action);
      else if (rule.action === "COMMIT" || rule.action === "ROLLBACK")
        await control(entry, rule.action);
    };
    const crash = (entry: ScriptRunEntry, failure: unknown) => {
      const text = message(failure);
      if (entry.error && entry.error !== text) say(entry, "ERROR", text);
      else entry.error = text;
      entry.status = "error";
      error ??= entry.error;
      halted = true;
      if (failure instanceof ScriptAbort) {
        stopped = true;
        error = text;
      }
    };
    const commandFailure = (entry: ScriptRunEntry, failure: string) => {
      entry.error = failure;
      error = failure;
      if (stopOnError && !plus.sqlError) halted = true;
    };
    const switchServerOutput = async (enabled: boolean) => {
      plus.serverOutput = enabled;
      if (!supports(connection, "server_output")) return;
      await toggleServerOutput(connection.kind, url, connection.id, enabled, database ?? undefined);
      const active = txId;
      if (active)
        await runManagedOperation(active, () =>
          executeInTransaction(
            active,
            enabled
              ? "BEGIN DBMS_OUTPUT.DISABLE; DBMS_OUTPUT.ENABLE(NULL); END;"
              : "BEGIN DBMS_OUTPUT.DISABLE; END;",
            internal,
          ),
        );
    };
    const describe = async (name: string): Promise<QueryResult> => {
      const started = performance.now();
      const target = oracleObjectName(name);
      if (!target)
        throw new Error(`DESC unterstützt Tabellen und Views der Form [schema.]name: ${name}`);
      const schema =
        target.schema ??
        first(await query("SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM dual"));
      const columns = await listTableColumnsDetailed(
        connection.kind,
        url,
        schema,
        target.object,
        database ?? undefined,
      );
      if (!columns.length) throw new Error(`Tabelle oder View nicht gefunden: ${name}`);
      return {
        columns: ["Name", "Null?", "Typ"],
        rows: columns.map((column) => ({
          Name: column.name,
          "Null?": column.is_nullable ? "" : "NOT NULL",
          Typ: column.data_type,
        })),
        rows_affected: null,
        execution_time_ms: Math.round(performance.now() - started),
      };
    };
    const settings = (): [string, string][] => [
      [
        "AUTOCOMMIT",
        plus.autocommit ? (plus.autocommit === 1 ? "ON" : String(plus.autocommit)) : "OFF",
      ],
      ["AUTOPRINT", plus.autoprint ? "ON" : "OFF"],
      ["CONCAT", session.state.concat === undefined ? "." : (session.state.concat ?? "OFF")],
      ["DEFINE", session.state.marker ?? "OFF"],
      ["ESCAPE", session.state.escape ?? "OFF"],
      ["EXITCOMMIT", plus.exitCommit ? "ON" : "OFF"],
      ["SERVEROUTPUT", plus.serverOutput ? "ON" : "OFF"],
      ["SPOOL", plus.spool ? plus.spool.path : "OFF"],
      ["VERIFY", plus.verify ? "ON" : "OFF"],
    ];
    const grid = async (entry: ScriptRunEntry, sql: string, empty: string) => {
      const result = await query(sql);
      entry.result = result;
      entry.rowCount = result.rows.length;
      lastResult = result;
      if (!result.rows.length) entry.feedback = empty;
    };
    const show = async (
      entry: ScriptRunEntry,
      what: string,
      rest: string,
    ): Promise<ScriptRunStatus> => {
      const setting = settings().find(([name]) => name.startsWith(what) && what.length >= 3);
      if (what.startsWith("ERR")) {
        const target = rest
          ? /^(?:(PACKAGE\s+BODY|TYPE\s+BODY|JAVA\s+SOURCE|JAVA\s+CLASS|PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE|VIEW|DIMENSION)\s+)?(\S+)$/i.exec(
              rest,
            )
          : null;
        const named = target ? oracleObjectName(target[2]) : null;
        const object = named
          ? {
              type: (target?.[1] ?? "").toUpperCase().replace(/\s+/g, " "),
              owner: named.schema,
              name: named.object,
            }
          : plus.lastObject;
        if (!object) {
          entry.feedback = "Keine Fehler.";
          return "success";
        }
        await grid(
          entry,
          `SELECT line || '/' || position AS "LINE/COL", text AS "ERROR" FROM all_errors WHERE owner = ${
            object.owner ? literal(object.owner) : "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')"
          } AND name = ${literal(object.name)}${object.type ? ` AND type = ${literal(object.type)}` : ""} ORDER BY sequence`,
          "Keine Fehler.",
        );
        return "success";
      }
      const context: Record<string, string> = {
        USER: "SESSION_USER",
        CON_NAME: "CON_NAME",
        CON_ID: "CON_ID",
        EDITION: "CURRENT_EDITION_NAME",
      };
      if (context[what]) {
        const value = first(
          await query(`SELECT SYS_CONTEXT('USERENV', '${context[what]}') FROM dual`),
        );
        say(entry, "INFO", what === "USER" ? `USER ist "${value}"` : `${what}: ${value}`);
        return "success";
      }
      if (what === "SQLCODE") {
        say(entry, "INFO", `sqlcode ${plus.sqlcode}`);
        return "success";
      }
      if (what === "RELEASE") {
        say(
          entry,
          "INFO",
          `release ${first(await query("SELECT version FROM product_component_version WHERE ROWNUM = 1"))}`,
        );
        return "success";
      }
      if (what.startsWith("PARAMETER") || what.startsWith("SPPARAMETER")) {
        const view = what.startsWith("SP") ? "v$spparameter" : "v$parameter";
        const value = what.startsWith("SP") ? "value" : "display_value";
        await grid(
          entry,
          `SELECT name AS "NAME", ${
            what.startsWith("SP")
              ? "type"
              : "CASE type WHEN 1 THEN 'boolean' WHEN 2 THEN 'string' WHEN 3 THEN 'integer' WHEN 4 THEN 'file' WHEN 6 THEN 'big integer' ELSE TO_CHAR(type) END"
          } AS "TYPE", ${value} AS "VALUE" FROM ${view}${
            rest ? ` WHERE name LIKE ${literal(`%${rest.toLowerCase()}%`)}` : ""
          } ORDER BY name`,
          "Keine Parameter gefunden.",
        );
        return "success";
      }
      if (what === "SGA") {
        await grid(entry, `SELECT name AS "NAME", value AS "VALUE" FROM v$sga`, "Keine Daten.");
        return "success";
      }
      if (what === "PDBS") {
        await grid(
          entry,
          `SELECT con_id AS "CON_ID", name AS "CON_NAME", open_mode AS "OPEN MODE", restricted AS "RESTRICTED" FROM v$pdbs ORDER BY con_id`,
          "Keine PDBs.",
        );
        return "success";
      }
      if (what.startsWith("RECYC")) {
        await grid(
          entry,
          `SELECT original_name AS "ORIGINAL NAME", object_name AS "RECYCLEBIN NAME", type AS "OBJECT TYPE", droptime AS "DROP TIME" FROM user_recyclebin ORDER BY droptime DESC`,
          "Papierkorb ist leer.",
        );
        return "success";
      }
      if (what === "ALL" || what === "") {
        for (const [name, value] of settings()) say(entry, "INFO", `${name} ${value}`);
        return "success";
      }
      if (setting) {
        say(entry, "INFO", `${setting[0]} ${setting[1]}`);
        return "success";
      }
      entry.note = `SHOW ${what} wird nicht unterstützt.`;
      return "ignored";
    };
    const printBinds = (entry: ScriptRunEntry, names: string[], quiet = false) => {
      const missing = names.find((name) => !plus.binds.has(name));
      if (missing) throw new Error(`SP2-0552: Bindvariable "${missing}" ist nicht deklariert.`);
      const scalars = names.filter((name) => plus.binds.get(name)?.dataType !== "REFCURSOR");
      for (const name of names.filter((name) => !scalars.includes(name))) {
        const bind = plus.binds.get(name);
        if (!bind?.cursor) {
          if (!quiet) throw new Error(`SP2-0625: REFCURSOR ${name} ist nicht geöffnet.`);
          continue;
        }
        entry.result = bind.cursor;
        entry.rowCount = bind.cursor.rows.length;
        entry.feedback = sqlplusFeedback("SELECT", bind.cursor);
        lastResult = bind.cursor;
        bind.cursor = null;
      }
      if (!scalars.length) return;
      const row = Object.fromEntries(
        scalars.map((name) => [name, plus.binds.get(name)?.value ?? null]),
      );
      if (entry.result || quiet) {
        for (const name of scalars) say(entry, "INFO", `${name}: ${row[name] ?? ""}`);
        return;
      }
      const result = { columns: scalars, rows: [row], rows_affected: null, execution_time_ms: 0 };
      entry.result = result;
      entry.rowCount = 1;
      lastResult = result;
    };
    const variable = (
      entry: ScriptRunEntry,
      command: Extract<SqlPlusCommand, { type: "variable" }>,
    ) => {
      if (!command.name) {
        if (!plus.binds.size) say(entry, "INFO", "Keine Bindvariablen deklariert.");
        for (const [name, bind] of plus.binds)
          say(entry, "INFO", `VARIABLE ${name} ${bind.dataType}`);
        return;
      }
      const known = plus.binds.get(command.name);
      if (!command.dataType) {
        if (!known)
          throw new Error(`SP2-0552: Bindvariable "${command.name}" ist nicht deklariert.`);
        if (command.value !== null) known.value = command.value;
        else say(entry, "INFO", `VARIABLE ${command.name} ${known.dataType}`);
        return;
      }
      if (!BIND_TYPE.test(command.dataType))
        throw new Error(`SP2-0553: Nicht unterstützter VARIABLE-Typ: ${command.dataType}`);
      plus.binds.set(command.name, {
        dataType: command.dataType,
        value: command.value,
        cursor: null,
      });
    };
    const spool = async (
      entry: ScriptRunEntry,
      command: Extract<SqlPlusCommand, { type: "spool" }>,
    ) => {
      await flushSpool(entry, entry.index);
      if (!command.file) return;
      if (/^(\\\\|\/\/)/.test(command.file))
        throw new Error("SPOOL auf Netzwerkpfade (UNC) ist nicht erlaubt.");
      if (command.file.split(/[\\/]/).some((part) => part === ".." || /^\.[^.]/.test(part)))
        throw new Error(
          "SPOOL-Pfade dürfen weder .. noch versteckte Ordner oder Dateien enthalten.",
        );
      const absolute = /^([\\/]|[A-Za-z]:[\\/])/.test(command.file);
      const base = request.filePath ? dirname(request.filePath) : null;
      if (!absolute && !base)
        throw new Error(
          "SPOOL mit relativem Pfad braucht eine gespeicherte Skriptdatei. Bitte einen absoluten Pfad angeben.",
        );
      const name = command.file.split(/[\\/]/).pop() ?? "";
      const withExtension = /\.[^.]+$/.test(name) ? command.file : `${command.file}.lst`;
      const extension = /\.([^.]+)$/.exec(withExtension)?.[1]?.toLowerCase() ?? "";
      if (!SPOOL_EXTENSIONS.has(extension))
        throw new Error(
          `SPOOL schreibt nur Protokolldateien (${[...SPOOL_EXTENSIONS].map((item) => `.${item}`).join(", ")}).`,
        );
      const separator = base?.includes("\\") && !base.includes("/") ? "\\" : "/";
      const path = absolute
        ? withExtension
        : `${base}${base?.endsWith(separator) ? "" : separator}${withExtension}`;
      const comparable = (value: string) => value.replace(/\\/g, "/").toLowerCase();
      if (items.some((item) => item.source && comparable(item.source) === comparable(path)))
        throw new Error(
          `SPOOL ${path}: Die Datei wird später per @ ausgeführt. l8db liest @-Dateien vor dem Lauf, ein während des Laufs erzeugtes Skript würde nicht ausgeführt.`,
        );
      const existing = await lstat(path).catch(() => null);
      if (existing && (existing.isSymlink || !existing.isFile))
        throw new Error(`SPOOL ${path}: Ziel ist keine normale Datei.`);
      if (existing && command.mode === "CREATE")
        throw new Error(`SPOOL ${path}: Datei existiert bereits (SP2-0771, SPOOL … CREATE).`);
      const accepted = await requestSqlConfirmation({
        connection: connection.name,
        database,
        statements: [
          {
            sql: path,
            reason: !existing
              ? "neue Datei"
              : command.mode === "APPEND"
                ? "wird ergänzt"
                : "wird überschrieben",
          },
        ],
        title: "Skriptprotokoll schreiben?",
        description: "Das Skript schreibt sein Protokoll per SPOOL in diese Datei.",
        confirmLabel: "Schreiben",
      });
      if (!accepted) abort("SPOOL vom Benutzer abgebrochen.");
      plus.spool = { path, mode: command.mode, from: entry.index + 1 };
      say(entry, "INFO", `Spool nach ${path}`);
    };
    const runCommand = async (raw: string, entry: ScriptRunEntry): Promise<ScriptRunStatus> => {
      let command = parseSqlPlusCommand(raw);
      if (SUBSTITUTED_COMMANDS.has(command.type)) {
        const text = substitute(raw, session.state, values).text;
        const shown = mask(raw) ?? text;
        if (text !== raw) command = parseSqlPlusCommand(text);
        if (shown !== raw) entry.sql = shown;
        if (command.type === "prompt" || command.type === "pause")
          command = parseSqlPlusCommand(shown);
      }
      switch (command.type) {
        case "connect":
          halted = true;
          throw new Error(CONNECT_UNSUPPORTED);
        case "host":
          halted = true;
          throw new Error(HOST_UNSUPPORTED);
        case "unsupported":
          halted = true;
          throw new Error(
            `${command.name} wird in l8db nicht unterstützt. Das Skript wurde angehalten, damit die folgenden Statements nicht unter falschen Annahmen laufen.`,
          );
        case "invalid":
          throw new Error(command.message);
        case "describe": {
          const result = await describe(command.name);
          entry.result = result;
          entry.rowCount = result.rows.length;
          lastResult = result;
          return "success";
        }
        case "whenever": {
          const rule = { exit: command.exit, status: command.status, action: command.action };
          if (command.event === "SQLERROR") plus.sqlError = rule;
          else plus.osError = rule;
          return "success";
        }
        case "exit":
          await exitScript(entry, command.status, command.action);
          return "success";
        case "serveroutput":
          await switchServerOutput(command.enabled);
          return "success";
        case "set-verify":
          plus.verify = command.enabled;
          return "success";
        case "set-autoprint":
          plus.autoprint = command.enabled;
          return "success";
        case "set-exitcommit":
          plus.exitCommit = command.enabled;
          return "success";
        case "set-autocommit":
          plus.autocommit = command.every;
          if (!txId && !command.every)
            say(
              entry,
              "WARNING",
              "Autocommit-Modus gewählt: SET AUTOCOMMIT OFF wirkt nicht, jedes Statement wird sofort festgeschrieben.",
            );
          return "success";
        case "prompt":
          say(entry, "PROMPT", command.text);
          return "success";
        case "pause": {
          const accepted = await requestSqlConfirmation({
            connection: connection.name,
            database,
            statements: [{ sql: command.text || "PAUSE", reason: "SQL*Plus PAUSE" }],
            title: "Skript pausiert",
            description: command.text || "Das Skript wartet auf Bestätigung.",
            confirmLabel: "Fortsetzen",
          });
          if (!accepted) {
            stopped = true;
            throw new Error("Skript bei PAUSE abgebrochen.");
          }
          return "success";
        }
        case "define-show": {
          const names = command.name ? [command.name] : Object.keys(session.state.defines).sort();
          for (const name of names) {
            const value = session.state.defines[name];
            if (value === undefined)
              throw new Error(`SP2-0135: Symbol ${name} ist nicht definiert.`);
            say(
              entry,
              "INFO",
              `DEFINE ${name} = "${hidden.has(name) ? masks[name] : value}" (CHAR)`,
            );
          }
          if (!names.length) say(entry, "INFO", "Keine Substitutionsvariablen definiert.");
          return "success";
        }
        case "accept":
          session.state.defines[command.name] = answers[command.name] ?? command.defaultValue ?? "";
          return "success";
        case "column":
          plus.columns.set(command.name, {
            newValue: command.newValue,
            oldValue: command.oldValue,
          });
          return "success";
        case "timing": {
          const now = performance.now();
          if (command.action === "START") {
            plus.timers.push({ name: command.name, started: now });
            return "success";
          }
          const timer = plus.timers.at(-1);
          if (!timer) {
            say(entry, "INFO", "Keine Zeitmessung aktiv.");
            return "success";
          }
          say(
            entry,
            "INFO",
            `Zeitmessung${timer.name ? ` ${timer.name}` : ""}: ${elapsed(now - timer.started)}`,
          );
          if (command.action === "STOP") plus.timers.pop();
          return "success";
        }
        case "show":
          if (
            command.what === "SPOOL" ||
            (command.what === "" && command.rest === "" && /^\s*SPO/i.test(raw))
          ) {
            say(entry, "INFO", plus.spool ? `Spool nach ${plus.spool.path}` : "Kein Spool aktiv.");
            return "success";
          }
          return show(entry, command.what, command.rest);
        case "variable":
          variable(entry, command);
          return "success";
        case "print":
          printBinds(entry, command.names.length ? command.names : [...plus.binds.keys()]);
          return "success";
        case "spool":
          await spool(entry, command);
          return "success";
        case "set-display":
          entry.note = DISPLAY_NOTE;
          return "ignored";
        case "set-unsupported":
          halted = true;
          throw new Error(
            `SET ${command.option} mit eigenem Trennzeichen wird nicht unterstützt; es gelten ; und /. Das Skript wurde angehalten, damit die folgenden Statements nicht falsch getrennt laufen.`,
          );
        case "run": {
          if (!lastSql) throw new Error("SP2-0103: Im SQL-Puffer steht nichts zum Ausführen.");
          await runStatement(lastSql, entry);
          return entry.status === "running" ? "error" : entry.status;
        }
        case "display":
          entry.note = `${command.name} ist ein Formatierungs- oder Pufferbefehl ohne Wirkung im Raster.`;
          return "ignored";
        case "other":
          entry.note = "Unbekannter SQL*Plus-Befehl.";
          return "ignored";
        default:
          return applySqlPlusSetting(command, session.state) ? "success" : "ignored";
      }
    };
    const record = (
      active: string,
      sql: string,
      result: QueryResult,
      changes: Awaited<ReturnType<typeof executeWithTransactionChanges>>["changes"],
    ) => {
      if (!isTransactionalStatement(sql, connection.kind)) return;
      for (const change of [
        {
          type: "query" as const,
          sql,
          rowsAffected: connection.kind === "dynamodb" ? null : result.rows_affected,
          planned: connection.kind === "dynamodb",
          detailsUnavailable:
            /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
            !changes.length &&
            Number(result.rows_affected) > 0,
        },
        ...changes,
      ]) {
        useTransactionStore.getState().addChange(active, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          ...change,
        });
      }
    };
    const execute = async (entry: ScriptRunEntry, sql: string): Promise<QueryResult> => {
      const options = {
        ...internal,
        noTimeLimit: oracle,
        onJob: (id: string) => {
          currentJob = id;
        },
      };
      const used =
        oracle && !/^\s*CREATE\b/i.test(sql)
          ? bindNames(sql).filter((name) => plus.binds.has(name))
          : [];
      const activeTxId = txId;
      const limited = applySelectRowLimit(
        expandSessionViews(sql, sessionViewsFor(connection.id, database), connection.kind),
        connection.kind,
        oracle ? 0 : (request.selectRowLimit ?? 0),
      );
      if (used.length) {
        const run = () =>
          executeWithBinds(
            connection.kind,
            url,
            limited,
            [...plus.binds].map(([name, bind]) => ({
              name,
              dataType: bind.dataType,
              value: bind.value,
            })),
            database ?? undefined,
            activeTxId,
            options,
          );
        const bound = activeTxId ? await runManagedOperation(activeTxId, run) : await run();
        for (const value of bound.binds) {
          const bind = plus.binds.get(value.name);
          if (!bind) continue;
          bind.value = value.value;
          if (bind.dataType === "REFCURSOR") bind.cursor = value.cursor;
        }
        if (plus.autoprint) printBinds(entry, used, true);
        if (activeTxId) record(activeTxId, entry.sql, bound.result, []);
        return bound.result;
      }
      const sessionResult = await runSessionViewStatement(connection, database, sql);
      if (sessionResult) return sessionResult;
      if (!activeTxId)
        return executeQuery(connection.kind, url, limited, database ?? undefined, options);
      const tracked = await runManagedOperation(activeTxId, () =>
        executeWithTransactionChanges(connection, database, activeTxId, sql, () =>
          executeInTransaction(activeTxId, limited, options),
        ),
      );
      record(activeTxId, entry.sql, tracked.result, tracked.changes);
      return tracked.result;
    };
    const runStatement = async (item: ScriptItem, entry: ScriptRunEntry) => {
      lastSql = item;
      let sql = item.text;
      if (oracle) {
        sql = substitute(item.text, session.state, values).text;
        entry.sql = mask(item.text) ?? sql;
        if (plus.verify && sql !== item.text) add(entry, verifyLines(item.text, entry.sql));
        if (sql !== previewed.get(item))
          await confirmSqlExecution(connection.kind, url, sql, database ?? undefined).catch(abort);
      }
      const words = oracle ? leadingWords(sql, 3) : [];
      const verb = words[0] ?? "";
      const ending =
        oracle && txId && (verb === "COMMIT" || (verb === "ROLLBACK" && !words.includes("TO")))
          ? (verb as ExitAction)
          : null;
      const ddl =
        oracle &&
        IMPLICIT_COMMIT.has(verb) &&
        !(verb === "ALTER" && ["SESSION", "SYSTEM"].includes(words[1]));
      const plsql = oracle && ["BEGIN", "DECLARE", "CALL", "EXEC", "EXECUTE"].includes(verb);
      const ends = plsql && /\b(COMMIT|ROLLBACK)\b/i.test(sql);
      entry.status = "running";
      publish();
      const started = performance.now();
      let failure: string | null = null;
      try {
        const active = txId;
        if (active && (ddl || (plsql && /\bCOMMIT\b/i.test(sql))))
          await confirmCommit(active, false);
        let result: QueryResult;
        if (ending) {
          await control(entry, ending, sql);
          result = { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
        } else result = await execute(entry, sql);
        if (!entry.result) {
          entry.result = result;
          entry.rowCount = result.columns.length ? result.rows.length : null;
          lastResult = result;
        }
        entry.rowsAffected = result.rows_affected == null ? null : Number(result.rows_affected);
        entry.status = "success";
        if (oracle) {
          entry.feedback ??= sqlplusFeedback(sql, result);
          if (result.columns.length && result.rows.length)
            for (const [column, target] of plus.columns) {
              const key = result.columns.find((name) => name.toUpperCase() === column);
              if (!key) continue;
              const value = result.rows.at(-1)?.[key];
              const text = value == null ? "" : String(value);
              if (target.newValue) session.state.defines[target.newValue] = text;
              if (target.oldValue) session.state.defines[target.oldValue] = text;
            }
          const created = createdObject(sql);
          if (created) plus.lastObject = created;
        }
        if (txId && ddl) useTransactionStore.getState().clearChanges(txId);
        else if (txId && ends) await settle();
        if (txId && plus.autocommit && (plsql || isTransactionalStatement(sql, connection.kind))) {
          plus.uncommitted += 1;
          if (plus.uncommitted >= plus.autocommit) {
            await control(entry, "COMMIT");
            say(entry, "INFO", "COMMIT (AUTOCOMMIT)");
          }
        }
      } catch (caught) {
        if (caught instanceof ScriptAbort) throw caught;
        failure = message(caught);
        if (oracle && failure.includes("ORA-24344") && createdObject(sql)) {
          const [, ...details] = failure.split("\n");
          const created = createdObject(sql);
          if (created) plus.lastObject = created;
          entry.status = "warning";
          entry.feedback = compileWarning(sql);
          for (const line of details) if (line.trim()) say(entry, "WARNING", line.trim());
          if (txId) useTransactionStore.getState().clearChanges(txId);
          failure = null;
        } else {
          entry.status = "error";
          entry.error = failure;
          const code = /ORA-(\d{5})/.exec(failure);
          plus.sqlcode = code ? Number(code[1]) : plus.sqlcode || 1;
          if (txId && (ddl || ends)) await settle();
        }
      } finally {
        currentJob = null;
        entry.durationMs = Math.round(performance.now() - started);
      }
      await collect(entry);
      if (failure !== null && /^SP2-\d{4}/.test(failure)) commandFailure(entry, failure);
      else if (failure !== null) await onRule(entry, oracle ? plus.sqlError : null, failure);
    };
    if (
      oracle &&
      session.state.marker &&
      items.some((item) => item.text.includes(`${session.state.marker}_`))
    ) {
      const missing = PREDEFINED_VARIABLES.filter(
        (name) => session.state.defines[name] === undefined,
      );
      if (missing.length) {
        const result = await query(
          "SELECT USER AS \"_USER\", TO_CHAR(SYSDATE) AS \"_DATE\", CASE SYS_CONTEXT('USERENV', 'ISDBA') WHEN 'TRUE' THEN 'AS SYSDBA' END AS \"_PRIVILEGE\", (SELECT version FROM product_component_version WHERE ROWNUM = 1) AS \"VERSION\" FROM dual",
        ).catch(() => null);
        const banner = await query("SELECT banner_full FROM v$version WHERE ROWNUM = 1")
          .then(first)
          .catch(() => "");
        const row = result?.rows[0] ?? {};
        const release = String(row.VERSION ?? "")
          .split(".")
          .slice(0, 5)
          .map((part) => part.padStart(2, "0").slice(-2))
          .join("")
          .padEnd(10, "0");
        const known: Record<string, string> = {
          _USER: String(row._USER ?? ""),
          _CONNECT_IDENTIFIER: connectIdentifier(connection.connectionString),
          _DATE: String(row._DATE ?? ""),
          _PRIVILEGE: String(row._PRIVILEGE ?? ""),
          _O_VERSION: banner || String(row.VERSION ?? ""),
          _O_RELEASE: row.VERSION ? release : "",
          _SQLPLUS_RELEASE: row.VERSION ? release : "",
          _EDITOR: "",
        };
        values = {
          ...Object.fromEntries(missing.map((name) => [name, known[name] ?? ""])),
          ...answers,
        };
      }
    }
    for (const item of items) {
      for (const [name, value] of Object.entries(item.defines ?? {}))
        session.state.defines[name] = substitute(value, session.state, values).text;
      const entry = entryOf.get(item);
      if (!entry) continue;
      if (stopped || halted) {
        entry.status = "skipped";
        publish();
        continue;
      }
      if (item.kind === "error") {
        entry.status = "error";
        entry.error = item.error ?? "Datei konnte nicht gelesen werden.";
        await onRule(entry, plus.osError, entry.error).catch((failure: unknown) =>
          crash(entry, failure),
        );
        publish();
        continue;
      }
      if (item.kind === "command") {
        const started = performance.now();
        entry.status = await runCommand(item.text, entry).catch(async (failure: unknown) => {
          const text = message(failure);
          if (failure instanceof ScriptAbort) crash(entry, failure);
          else if (text.startsWith("SPOOL ")) {
            entry.error = text;
            await onRule(entry, plus.osError, text).catch((nested: unknown) =>
              crash(entry, nested),
            );
          } else commandFailure(entry, text);
          return "error" as const;
        });
        entry.durationMs = Math.round(performance.now() - started);
        publish();
        continue;
      }
      await runStatement(item, entry).catch((failure: unknown) => crash(entry, failure));
      updateTask(jobId, {
        progress: entries.filter(
          (entry) => entry.status !== "pending" && entry.status !== "skipped",
        ).length,
        detail: txId
          ? "Ausgeführt in einer verwalteten Transaktion. Commit oder Rollback erfolgt separat im Transaktionspanel."
          : "Autocommit: Erfolgreiche Statements wurden einzeln übernommen.",
      });
      publish();
    }
    const tail = entries.at(-1);
    if (tail && plus.spool)
      await flushSpool(tail, entries.length).catch((failure: unknown) => {
        tail.error ??= message(failure);
        error ??= tail.error;
      });
    const ran = entries.filter((entry) => entry.durationMs !== null);
    if (ran.length)
      useQueryHistoryStore.getState().record({
        connectionId: connection.id,
        database,
        sql: request.sql,
        durationMs: ran.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
        rowCount: ran.length === 1 ? (ran[0].rowCount ?? ran[0].rowsAffected) : null,
        error: ran.find((entry) => entry.error)?.error ?? null,
      });
    const openTx = txId;
    if (openTx && oracle && !exit) {
      const open = await pendingTransaction().catch(() => true);
      if (!open) {
        useTransactionStore.getState().clearChanges(openTx);
        if (mode === "new-transaction") {
          await finishManagedTransaction(openTx, false).catch(() => undefined);
          txId = null;
        }
      } else useTransactionStore.getState().setPanelOpen(true);
    }
    const reopened = txId;
    if (reopened && oracle && !plus.serverOutput)
      await runManagedOperation(reopened, () =>
        executeInTransaction(reopened, "BEGIN DBMS_OUTPUT.ENABLE(NULL); END;", internal),
      ).catch(() => undefined);
    const touchedTxId = txId;
    if (touchedTxId && entries.some((entry) => entry.status === "success"))
      await runManagedOperation(touchedTxId, () => refreshDatabaseChanges(connection, touchedTxId));
    if (stopped && entries.some((entry) => entry.status === "skipped") && !error)
      error = "Skript zwischen den Statements abgebrochen.";
    const finalExit = exit as ScriptExit | null;
    if (finalExit && finalExit.code !== 0 && !error)
      error = `Skript mit EXIT ${finalExit.label} (Code ${finalExit.code}) beendet.`;
    forget();
    const outcome = { entries, lastResult, error, txId, exit: finalExit };
    finishTask(
      jobId,
      {
        statements: entries.map(({ result: _result, output: _output, ...entry }) => entry),
        txId,
      },
      error,
    );
    return outcome;
  } catch (failure) {
    forget();
    finishTask(jobId, undefined, failure);
    throw failure;
  }
}
