# Backup, restore and dumps

The backup view (`/backup`, sidebar "Sichern & Wiederherstellen", connection card menu) is gated by the `backup` capability in `DatabaseKind::capabilities()`. It is enabled for PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, MongoDB and Redis.

| Family | Backup | Restore |
| --- | --- | --- |
| PostgreSQL | `pg_dump` in plain, custom, directory (`--jobs`) or tar format; schema-only/data-only, include/exclude schemas and tables, `--clean --if-exists`, `--no-owner`, `--no-privileges`. `pg_dumpall --globals-only` for roles and tablespaces. | Format is detected from the file: `PGDMP` header → custom, `ustar` → tar, directory with `toc.dat` → directory, otherwise plain SQL. Archives use `pg_restore` (`--clean`, `--if-exists`, `--no-owner`, `--jobs`, `--single-transaction`, `--exit-on-error`), plain SQL uses `psql --no-psqlrc` with `ON_ERROR_STOP` and optional `--single-transaction`. |
| MySQL/MariaDB | `mysqldump` or `mariadb-dump` with `--single-transaction`, `--routines`, `--triggers`, `--events`, `--no-data`/`--no-create-info`, selected or ignored tables. MySQL tools add `--set-gtid-purged=OFF`. | `mysql`/`mariadb` reads the SQL file through stdin; progress is reported in bytes. `--force` is used when "Beim ersten Fehler abbrechen" is off. |
| SQLite | SQLite online backup API (rusqlite), written into a temporary file in the target directory and atomically renamed. | Backup API from the selected file into the connected database file. |
| MongoDB | `mongodump --archive` with optional `--gzip`, one collection or excluded collections. | `mongorestore --archive` with `--gzip`, `--drop`, `--stopOnError`; `--nsInclude`, or `--nsFrom/--nsTo` when the archive's source database differs from the target. |
| SQL Server | `BACKUP DATABASE … TO DISK` with `INIT`, `STATS`, optional `COPY_ONLY` and `COMPRESSION`. The path is on the server. | `RESTORE DATABASE … FROM DISK` with optional `REPLACE`; optionally `SINGLE_USER WITH ROLLBACK IMMEDIATE` before and `MULTI_USER` afterwards. Runs against `master`. |
| Redis | `BGSAVE` on the server. | Not supported. |

## Tool discovery

`backup_tools.rs` searches `PATH` first, then Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`, keg-only `libpq`, `postgresql@*`, `mysql-client*`, `mariadb*`, `mongodb-database-tools`), Postgres.app (`/Applications/Postgres.app/Contents/Versions/*/bin`), `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin` and on Windows `C:\Program Files\PostgreSQL\*\bin`, `MySQL Server *`, `MariaDB *` and `MongoDB\Tools\*`. GUI apps on macOS do not inherit the shell `PATH`, so these fixed locations matter. Every candidate is started with `--version`; the newest version wins. The "Werkzeuge" tab lists all candidates and accepts a custom path (binary or directory) per tool, stored under `l8db.backup-tools` in localStorage.

The probe also reads the server version. PostgreSQL warns when `pg_dump`, `pg_dumpall` or `pg_restore` is older than the server major version (pg_dump refuses such servers). MySQL warns on MySQL/MariaDB flavor mismatch and on differing MySQL release series.

## Security

- Passwords are never passed as arguments. PostgreSQL tools receive `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` and `PGOPTIONS` (including a proxy-user role and read-only options) through the child environment.
- MySQL tools get `--defaults-extra-file` pointing to a temporary option file with mode 0600 that contains only the password. MongoDB tools get `--config` with a temporary 0600 YAML file containing the URI. Both files are deleted when the process ends.
- Log lines are redacted against the connection password before they are emitted or stored.
- All calls use `effectiveConnectionString()`, so backups and restores go through an active SSH tunnel (`127.0.0.1:<tunnelPort>`); there is no direct-connect fallback.
- Restore requires typing the target database (or connection name) in a confirmation dialog that shows connection, server, database, source and destructive options. Connections with `readOnly` are blocked in the UI, `run_restore` is a read-only-guarded write command in the bridge, and the backend rejects PostgreSQL URLs carrying `default_transaction_read_only=on`.

## Execution

`run_backup` and `run_restore` run inside `execution::run` with the task's job id. Output from stdout and stderr (tools run with `--verbose`) is streamed as `backup-log` events in 250 ms batches; byte or page progress arrives as `backup-progress`. Jobs appear in the Tasks dialog; cancelling kills the child process. Output files or directories that did not exist before a failed or cancelled backup are removed. SQL Server and Redis statements cannot be interrupted server-side; cancel only stops waiting.

## Limitations

- libpq reads `verify-ca`/`verify-full` roots from `~/.postgresql/root.crt`, not from the OS certificate store used by the app's own connections.
- `mysqldump` 8.x against MariaDB servers may need `--column-statistics=0`; this is not added automatically.
- Gzip-compressed plain SQL files must be decompressed before restore.
- SQL Server restores do not support `WITH MOVE`; the backup must fit the server's file layout.
- MongoDB restores of `mongodb+srv` URIs depend on the installed database tools version.

## Tests

- `cargo test --lib backup` covers argument building, format detection, URI rewriting, option-file quoting, version parsing, tool discovery, log redaction, stdin feeding, cancellation and a SQLite round trip.
- `bun test tests/backup.test.ts` covers the frontend helpers.
- Live round trips are ignored tests in `backup_live_tests.rs`, enabled by environment variables:

```sh
L8DB_BACKUP_PG_URL='postgresql://postgres:secret@127.0.0.1:5432/postgres' \
L8DB_BACKUP_MYSQL_URL='mysql://root:secret@127.0.0.1:3306/shop' \
L8DB_BACKUP_MONGO_URL='mongodb://root:secret@127.0.0.1:27017/?directConnection=true' \
cargo test --lib backup_live -- --ignored --test-threads=1 --nocapture
```

`L8DB_BACKUP_TOOL_DIR` forces a tool directory (for example wrappers that `docker exec` into the database container), `L8DB_BACKUP_DIR` sets the output directory, and `L8DB_BACKUP_OLD_PG_DUMP` points to an older `pg_dump` to check the version warning and the refused dump.
