# SQL*Plus scripts

"Skript mit Einzelergebnissen" runs Oracle scripts like `sqlplus user@db @script.sql`. The runner is `runSqlScript` in `src/lib/script-runner.ts`; commands are parsed in `src/lib/sql-statements/sqlplus.ts`, feedback and the transcript come from `src/lib/sqlplus-output.ts`.

## Session and transactions

- **Managed transaction (default with DML):** SQL*Plus behaviour with `AUTOCOMMIT OFF`. All statements run in one dedicated Oracle session. `COMMIT`/`ROLLBACK` in the script are executed in that session and clear the transaction panel; DDL commits implicitly. PL/SQL blocks that contain `COMMIT`/`ROLLBACK` are followed by a `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` check. Changes still open at the end stay in the transaction panel (like the SQL*Plus prompt); without open changes the session is closed.
- **Autocommit:** like `SET AUTOCOMMIT ON`. `ROLLBACK`, `WHENEVER … ROLLBACK` and `EXIT ROLLBACK` cannot undo anything and say so in the output.
- `WHENEVER SQLERROR|OSERROR EXIT [SUCCESS|FAILURE|WARNING|n|variable|:bind|SQL.SQLCODE] [COMMIT|ROLLBACK]` and `CONTINUE [COMMIT|ROLLBACK|NONE]` work as in SQL*Plus. `EXIT` without a clause commits (`SET EXITCOMMIT OFF` rolls back). The exit code is shown in the result list; a non-zero code marks the run as failed.
- Until the script sets `WHENEVER`, the dialog option "Bei Fehler stoppen" decides. SQL*Plus command errors (SP2) never trigger `WHENEVER SQLERROR`.
- Compilation errors (`ORA-24344`) are warnings: the statement is marked amber, the messages are listed and `WHENEVER SQLERROR` does not fire. `SHOW ERRORS` lists `ALL_ERRORS` for the last created object or a named one.
- `SET AUTOCOMMIT ON|IMMEDIATE|n` commits after every (n-th) DML or PL/SQL statement inside the managed transaction.

## Output

Every statement shows what SQL*Plus would print: `PROMPT` text, `DBMS_OUTPUT` lines (with `SET SERVEROUTPUT ON`, also when the block fails), `VERIFY` old/new lines, feedback such as "6 Zeilen aktualisiert." and the exit line. Other database families attach their server messages (PostgreSQL `RAISE`, SQL Server `PRINT`, MySQL warnings …) to each statement in the same way. "Protokoll kopieren" copies the whole run as text. At most 20,000 output lines are kept per run.

## Supported commands

| Command | Behaviour |
|---|---|
| `@`, `@@`, `START` with arguments | Files beside the script or from SQLPATH; arguments become `&1`, `&2` … |
| `DEFINE`, `UNDEFINE`, `ACCEPT … [DEFAULT] [PROMPT] [HIDE]` | Substitution variables; `ACCEPT` values are asked before the run, `HIDE` values are not kept |
| `SET DEFINE/SCAN/ESCAPE/CONCAT/VERIFY` | Substitution settings; `&_USER`, `&_CONNECT_IDENTIFIER`, `&_DATE`, `&_PRIVILEGE`, `&_O_VERSION` are predefined |
| `COLUMN x NEW_VALUE v` / `OLD_VALUE v` | Sets `&v` from the last fetched row |
| `VARIABLE`, `PRINT`, `EXEC`, `:name`, `SET AUTOPRINT` | Bind variables (NUMBER, BINARY_FLOAT/DOUBLE, [N]CHAR, [N]VARCHAR2, [N]CLOB, BOOLEAN, REFCURSOR) bound IN OUT on the Oracle session |
| `SET SERVEROUTPUT`, `PROMPT`, `PAUSE` | `PAUSE` asks for confirmation; cancelling stops the script |
| `SPOOL file [CREATE|REPLACE|APPEND]` / `SPOOL OFF` | Writes the transcript; relative paths resolve beside the saved script, `.lst` is added; only `.lst .log .txt .out .csv .sql .html .htm .xml .json`, no dot files |
| `SHOW ERRORS/USER/CON_NAME/CON_ID/EDITION/SQLCODE/RELEASE/PARAMETERS/SPPARAMETERS/SGA/PDBS/RECYCLEBIN/ALL/<setting>` | Grid or output line |
| `TIMING START/SHOW/STOP`, `DESCRIBE`, `REMARK` | As in SQL*Plus |

Display and buffer commands (`SET LINESIZE/PAGESIZE/FEEDBACK/ECHO/TERMOUT/…`, `COLUMN … FORMAT`, `TTITLE`, `BREAK`, `COMPUTE`, `CLEAR`, `LIST`, `RUN` …) are listed as ignored with the reason, because results are grids. `CONNECT`, `DISCONNECT`, `HOST`, `STARTUP`, `SHUTDOWN`, `RECOVER`, `ARCHIVE LOG`, `PASSWORD`, `COPY` and `XQUERY` stop the script instead of being skipped. `SET SQLTERMINATOR/BLOCKTERMINATOR/CMDSEP` are not supported; `;` and `/` always end statements, and blank lines never end a statement. A `/` after a statement that already ended with `;` does not run it a second time. Commands continue on the next line after a trailing ` -`.

## Tests

- `tests/sqlplus-script.test.ts` (runner with mocked transport), `tests/sqlplus-commands.test.ts` (parser, splitter, feedback), `tests/perf-sqlplus-script.test.ts` (requests per statement, output cap, cancellation).
- Live: `L8DB_ORACLE_BROWSER_TESTS=tests/oracle-sqlplus-browser.test.ts bun run test:oracle-browser` runs a real rollout script (success and deviating state) plus bind variables, REFCURSOR, `COLUMN NEW_VALUE`, compile warnings and `SHOW ERRORS` against the Oracle lab.
