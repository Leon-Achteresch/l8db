# SQL*Plus scripts

"Skript mit Einzelergebnissen" (and running several Oracle statements at once) executes Oracle scripts with SQL*Plus semantics. The runner is `runSqlScript` in `src/lib/script-runner.ts`; commands are parsed in `src/lib/sql-statements/sqlplus.ts`, feedback and the transcript come from `src/lib/sqlplus-output.ts`, bind variables run through the Tauri command `execute_with_binds` (`src-tauri/src/db/oracle.rs`).

## Session and transactions

- **Managed transaction (default for Oracle scripts):** like SQL*Plus with `AUTOCOMMIT OFF`, in one dedicated Oracle session. It is chosen whenever the provider supports transactions and transactions are enabled in the settings, also for master scripts that only call `@` files. `COMMIT`/`ROLLBACK` run in that session and clear the transaction panel; DDL commits implicitly. PL/SQL blocks that contain `COMMIT`/`ROLLBACK` are followed by a `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` check. Changes still open at the end stay in the transaction panel (like the SQL*Plus prompt); without open changes the session is closed.
- **Existing transaction:** when the target already has an open transaction, the script runs inside it, so `COMMIT`, `EXIT` and `WHENEVER … ROLLBACK` also finish earlier edits of that transaction.
- **Autocommit:** like `SET AUTOCOMMIT ON` in the shared editor session (session settings of earlier editor statements apply). `ROLLBACK`, `WHENEVER … ROLLBACK` and `EXIT ROLLBACK` cannot undo anything and say so in the output.
- **Production:** every commit the script causes asks like the transaction panel (`productionConfirmCommit`): explicit `COMMIT`, `EXIT`/`WHENEVER … EXIT` with commit, `SET AUTOCOMMIT`, and DDL or `COMMIT`-containing PL/SQL while the transaction has changes. Declining stops the script; the transaction stays open. Statements whose text changes at runtime (`COLUMN … NEW_VALUE`, nested `DEFINE`) are checked again for destructive SQL. Read-only mode and the production write lock apply to bind statements as to every other statement.
- `WHENEVER SQLERROR|OSERROR EXIT [SUCCESS|FAILURE|WARNING|n|variable|:bind|SQL.SQLCODE] [COMMIT|ROLLBACK]` and `CONTINUE [COMMIT|ROLLBACK|NONE]` work as in SQL*Plus. `EXIT` without a clause commits (`SET EXITCOMMIT OFF` rolls back). The exit code is shown in the result list; a non-zero code marks the run as failed.
- Until the script sets `WHENEVER SQLERROR`, the dialog option "Bei Fehler stoppen" decides for SQL errors and SQL*Plus command errors (SP2). After `WHENEVER SQLERROR`, SP2 errors never stop the script. Missing `@` files and SPOOL write errors follow `WHENEVER OSERROR`, or the dialog option before that.
- Script statements (also in the SQL import) run without the app's query timeout, as in SQL*Plus (`noTimeLimit` in `ExecutionOptions`, see `query_duration` in `src-tauri/src/db/execution.rs`); "Stopp" in the task list cancels the running statement (live: a long query stops after about 0.8 s). Calls that OCI cannot interrupt, such as `DBMS_SESSION.SLEEP`, still run to their end unless the session can be killed. Helper queries of the runner (COMMIT/ROLLBACK, SHOW, DESCRIBE, transaction checks), other families and normal editor queries keep the configured timeout.
- Compilation errors of `CREATE` statements (`ORA-24344`) are warnings: the statement is marked amber, the messages are listed and `WHENEVER SQLERROR` does not fire. `SHOW ERRORS` lists `ALL_ERRORS` for the last created object or a named one.

## Output

Every statement shows `PROMPT` text, `DBMS_OUTPUT` lines (with `SET SERVEROUTPUT ON`, also when the block fails, read completely), `VERIFY` old/new lines, feedback such as "6 Zeilen aktualisiert." and the exit line. Other database families attach their server messages (PostgreSQL `RAISE`, SQL Server `PRINT`, MySQL warnings …) to each statement in the same way; messages left from earlier queries are moved to the Server-Ausgabe before the first statement. "Protokoll kopieren" copies the whole run as text. At most 20,000 output lines are kept per run.

## Supported commands

| Command | Behaviour |
|---|---|
| `@`, `@@`, `START` with arguments | `@` resolves beside the main script, then SQLPATH; `@@` beside the calling file. Arguments become `&1`, `&2` … and are substituted when the file starts. UNC paths are refused |
| `DEFINE`, `UNDEFINE`, `ACCEPT … [DEFAULT] [PROMPT] [HIDE]` | Substitution variables; `ACCEPT` values are asked before the run. `HIDE` values are shown as `********` and forgotten after the run |
| `SET DEFINE/SCAN/ESCAPE/CONCAT/VERIFY` | Substitution settings. `&_USER`, `&_CONNECT_IDENTIFIER` (TNS alias or host:port/service), `&_DATE`, `&_PRIVILEGE`, `&_O_VERSION` (banner), `&_O_RELEASE` and `&_SQLPLUS_RELEASE` (server release) are predefined |
| `COLUMN x NEW_VALUE v` / `OLD_VALUE v` | Sets `&v` from the last fetched row |
| `VARIABLE`, `PRINT`, `EXEC`, `:name`, `SET AUTOPRINT` | Bind variables (NUMBER, BINARY_FLOAT/DOUBLE, [N]CHAR, [N]VARCHAR2 incl. `CHAR` semantics, [N]CLOB, BOOLEAN, REFCURSOR) bound IN OUT on the session; results and cursors use the normal row cap |
| `SET SERVEROUTPUT`, `PROMPT`, `PAUSE` | `PAUSE` asks for confirmation; cancelling stops the script |
| `/`, `RUN` | Run the last SQL statement again, as in SQL*Plus. The `/` that ends a PL/SQL block runs it once |
| `SPOOL file [CREATE|REPLACE|APPEND]` / `SPOOL OFF` | Writes the transcript after a confirmation. Relative paths resolve beside the saved script, `.lst` is added; only `.lst .log .txt .out`, no `..`, hidden or UNC paths, no symlinks, and no file that the script later runs with `@` |
| `SHOW ERRORS/USER/CON_NAME/CON_ID/EDITION/SQLCODE/RELEASE/PARAMETERS/SPPARAMETERS/SGA/PDBS/RECYCLEBIN/ALL/<setting>` | Grid or output line |
| `TIMING START/SHOW/STOP`, `DESCRIBE` (tables and views), `REMARK` | As in SQL*Plus |

Display and buffer commands (`SET LINESIZE/PAGESIZE/FEEDBACK/ECHO/TERMOUT/…`, `COLUMN … FORMAT`, `TTITLE`, `BREAK`, `COMPUTE`, `CLEAR`, `LIST` …) are listed as ignored with the reason, because results are grids. `CONNECT`, `DISCONNECT`, `HOST`, `STARTUP`, `SHUTDOWN`, `RECOVER`, `ARCHIVE LOG`, `PASSWORD`, `COPY`, `XQUERY` and `SET SQLTERMINATOR/BLOCKTERMINATOR/CMDSEP/SQLPREFIX` with a non-default character stop the script instead of being skipped. Commands continue on the next line after a trailing ` -`.

## Known differences to SQL*Plus

- Oracle sessions use `NLS_DATE_FORMAT 'YYYY-MM-DD HH24:MI:SS'` and `NLS_NUMERIC_CHARACTERS '.,'`; scripts that rely on implicit date or number conversion should set `ALTER SESSION` themselves.
- `@` files are read before the run: `@&variable` file names and scripts generated during the run are not supported (both are refused).
- Substitution state is kept per editor tab and connection across runs, like an interactive SQL*Plus session.
- `ACCEPT` is asked before the first statement, not when the script reaches it.
- Blank lines never end a statement (`SQLBLANKLINES ON`), a final statement without `;` or `/` is executed, a `.` line does not end a block, and lines are classified before substitution (`&var` cannot turn a line into a comment).
- `SET SERVEROUTPUT ON SIZE n` always enables an unlimited buffer.
- `&` inside comments is not substituted.
- SPOOL writes l8db's transcript format, not SQL*Plus text reports.
- Exit codes are shown as given, not modulo 256.
- Other script paths behave differently: the MCP `script` tool runs one transaction with its own SQL*Plus subset (no `@`, `VARIABLE`, `SPOOL`, `ACCEPT`), and `l8db query -f` skips SQL*Plus commands.
- Server messages of other families are collected per connection; queries of other tabs on the same connection that run at the same time can show up under a script statement.

## Tests

- `tests/sqlplus-script.test.ts` (runner with mocked transport), `tests/sqlplus-commands.test.ts` (parser, splitter, feedback), `tests/perf-sqlplus-script.test.ts` (requests per statement, output cap, cancellation).
- Live: `L8DB_ORACLE_BROWSER_TESTS=tests/oracle-sqlplus-browser.test.ts bun run test:oracle-browser` runs a real rollout script (success and deviating state) plus bind variables, REFCURSOR, `COLUMN NEW_VALUE`, compile warnings and `SHOW ERRORS` against the Oracle lab.
