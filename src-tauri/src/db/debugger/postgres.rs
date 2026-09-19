use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio_postgres::Client;
use tokio_util::sync::CancellationToken;

use super::{Action, Availability, Backend, Breakpoint, Frame, Launch, Snapshot, Variable, Watch};
use crate::db::{connection, execution, map_pg_err, quote_ident, SslMode};

async fn extension(client: &Client) -> Result<String, String> {
    let row = client.query_opt("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pldbgapi'", &[]).await.map_err(map_pg_err)?;
    row.map(|row| quote_ident(row.get::<_, &str>(0))).ok_or_else(|| "Die Server-Erweiterung pldbgapi fehlt. Ein Administrator muss pldebugger auf dem Server bereitstellen und pldbgapi in dieser Datenbank aktivieren.".into())
}

pub async fn availability(url: &str, database: Option<&str>) -> Result<Availability, String> {
    let (config, ssl) = connection::parse_connection(url, database)?;
    let client = execution::connect_postgres(&config, ssl).await?;
    match extension(&client).await {
        Ok(schema) => {
            let probe = client
                .simple_query(&format!("SELECT * FROM {schema}.pldbg_get_proxy_info()"))
                .await;
            Ok(Availability { available: probe.is_ok(), engine: Some("pldebugger".into()), message: probe.err().map(map_pg_err).unwrap_or_else(|| "PL/pgSQL-Debugger verfügbar. Nicht explizit bestätigte Änderungen werden am Ende zurückgerollt; COMMIT innerhalb der Routine bleibt wirksam.".into()), step_out: true })
        }
        Err(message) => Ok(Availability {
            available: false,
            engine: Some("pldebugger".into()),
            message,
            step_out: true,
        }),
    }
}

pub struct PgDebugger {
    control: Arc<Client>,
    target: Arc<Client>,
    ssl: SslMode,
    schema: String,
    handle: i32,
    breakpoints: Vec<Breakpoint>,
    execution: Option<tokio::task::JoinHandle<Result<(), String>>>,
    stopped: bool,
}

impl Drop for PgDebugger {
    fn drop(&mut self) {
        let control = self.control.clone();
        let target = self.target.clone();
        let ssl = self.ssl;
        let task = self.execution.take();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Ok(tls) = connection::tls_connector(ssl) {
                    let _ = control.cancel_token().cancel_query(tls).await;
                }
                if let Ok(tls) = connection::tls_connector(ssl) {
                    let _ = target.cancel_token().cancel_query(tls).await;
                }
                if let Some(task) = task {
                    task.abort();
                }
                let _ =
                    tokio::time::timeout(Duration::from_secs(5), target.batch_execute("ROLLBACK"))
                        .await;
            });
        }
    }
}

pub async fn launch(
    url: &str,
    database: Option<&str>,
    request: &Launch,
    state: &mut Snapshot,
    cancel: CancellationToken,
) -> Result<PgDebugger, String> {
    let oid: u32 = request
        .oid
        .parse()
        .map_err(|_| "Ungültige PostgreSQL-Routinen-ID")?;
    let (config, ssl) = connection::parse_connection(url, database)?;
    let control = Arc::new(execution::connect_postgres(&config, ssl).await?);
    let schema = extension(&control).await?;
    let target = Arc::new(execution::connect_postgres(&config, ssl).await?);
    let mut backend = PgDebugger {
        control,
        target,
        ssl,
        schema,
        handle: 0,
        breakpoints: vec![],
        execution: None,
        stopped: false,
    };
    let initialized = tokio::select! {
        result = backend.initialize(oid, request, state) => result,
        _ = cancel.cancelled() => Err("Debug-Start abgebrochen.".into()),
        _ = tokio::time::sleep(Duration::from_secs(30)) => Err("Kein Debug-Ziel innerhalb von 30 Sekunden erreicht. Prüfen Sie Aufruf, Routine und pldebugger-Konfiguration.".into()),
    };
    initialized?;
    Ok(backend)
}

impl PgDebugger {
    fn sql(&self, function: &str, arguments: &str) -> String {
        format!("SELECT * FROM {}.{function}({arguments})", self.schema)
    }

    async fn initialize(
        &mut self,
        oid: u32,
        request: &Launch,
        state: &mut Snapshot,
    ) -> Result<(), String> {
        let routine = self.control.query_opt("SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = $1", &[&oid]).await.map_err(map_pg_err)?.ok_or("Routine nicht gefunden")?;
        if routine.get::<_, &str>(0) != "plpgsql" {
            return Err("Diese Routine ist nicht in PL/pgSQL geschrieben.".into());
        }
        self.handle = self
            .control
            .query_one(&self.sql("pldbg_create_listener", ""), &[])
            .await
            .map_err(map_pg_err)?
            .get(0);
        let pid: i32 = self
            .target
            .query_one("SELECT pg_backend_pid()", &[])
            .await
            .map_err(map_pg_err)?
            .get(0);
        self.control
            .query_one(
                &self.sql("pldbg_set_global_breakpoint", "$1, $2, -1, $3"),
                &[&self.handle, &oid, &pid],
            )
            .await
            .map_err(map_pg_err)?;
        let target = self.target.clone();
        let sql = request.sql.clone();
        self.execution = Some(tokio::spawn(async move {
            target.batch_execute("BEGIN").await.map_err(map_pg_err)?;
            let result = target.batch_execute(&sql).await.map_err(map_pg_err);
            let cleanup = target.batch_execute("ROLLBACK").await.map_err(map_pg_err);
            result.and(cleanup)
        }));
        let wait_sql = self.sql("pldbg_wait_for_target", "$1");
        let wait_params: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[&self.handle];
        tokio::select! {
            result = self.control.query_one(&wait_sql, wait_params) => { result.map_err(map_pg_err)?; }
            result = self.execution.as_mut().ok_or("Debug-Ziel fehlt")? => {
                result.map_err(|_| "Debug-Ziel unerwartet beendet")??;
                return Err("Das Aufrufskript hat die gewählte Routine nicht erreicht.".into());
            }
        }
        self.control
            .query_one(
                &self.sql("pldbg_wait_for_breakpoint", "$1"),
                &[&self.handle],
            )
            .await
            .map_err(map_pg_err)?;
        self.set_breakpoints(request.breakpoints.clone()).await?;
        self.inspect(state, 0).await
    }

    async fn set_breakpoints(&mut self, breakpoints: Vec<Breakpoint>) -> Result<(), String> {
        let parsed = breakpoints
            .iter()
            .map(|b| {
                b.oid
                    .parse::<u32>()
                    .map(|oid| (oid, b.line))
                    .map_err(|_| "Ungültige Breakpoint-Routinen-ID".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        for b in &self.breakpoints {
            let oid: u32 = b
                .oid
                .parse()
                .map_err(|_| "Ungültige Breakpoint-Routinen-ID")?;
            self.control
                .query_one(
                    &self.sql("pldbg_drop_breakpoint", "$1, $2, $3"),
                    &[&self.handle, &oid, &b.line],
                )
                .await
                .map_err(map_pg_err)?;
        }
        self.breakpoints.clear();
        for ((oid, line), breakpoint) in parsed.into_iter().zip(breakpoints) {
            let row = self
                .control
                .query_one(
                    &self.sql("pldbg_set_breakpoint", "$1, $2, $3"),
                    &[&self.handle, &oid, &line],
                )
                .await
                .map_err(map_pg_err)?;
            if !row.get::<_, bool>(0) {
                return Err(format!(
                    "Breakpoint in Zeile {line} konnte nicht gesetzt werden."
                ));
            }
            self.breakpoints.push(breakpoint);
        }
        Ok(())
    }

    async fn inspect(&self, state: &mut Snapshot, selected: i32) -> Result<(), String> {
        let rows = self
            .control
            .query(&self.sql("pldbg_get_stack", "$1"), &[&self.handle])
            .await
            .map_err(map_pg_err)?;
        state.frames = rows
            .iter()
            .map(|r| Frame {
                id: r.get(0),
                name: r.get(1),
                oid: r.get::<_, u32>(2).to_string(),
                line: r.get(3),
            })
            .collect();
        state.variables = self
            .control
            .query(&self.sql("pldbg_get_variables", "$1"), &[&self.handle])
            .await
            .map_err(map_pg_err)?
            .iter()
            .map(|r| Variable {
                name: r.get(0),
                datatype: r.get::<_, u32>(6).to_string(),
                value: r.get(7),
            })
            .collect();
        state.watches = state.watches.iter().map(|watch| {
            let variable = state.variables.iter().find(|v| v.name == watch.name);
            Watch { name: watch.name.clone(), value: variable.and_then(|v| v.value.clone()), error: variable.is_none().then(|| "Variable in diesem Frame nicht verfügbar. Unterstützt werden Variablennamen, keine SQL-Ausdrücke.".into()) }
        }).collect();
        state.selected_frame = selected;
        if let Some(frame) = state.frames.iter().find(|f| f.id == selected) {
            let oid: u32 = frame.oid.parse().map_err(|_| "Ungültiger Stack-Frame")?;
            state.source = self
                .control
                .query_one(
                    &self.sql("pldbg_get_source", "$1, $2"),
                    &[&self.handle, &oid],
                )
                .await
                .map_err(map_pg_err)?
                .get(0);
        }
        state.status = "paused".into();
        state.message = None;
        Ok(())
    }
}

#[async_trait]
impl Backend for PgDebugger {
    async fn action(&mut self, action: Action, state: &mut Snapshot) -> Result<(), String> {
        let function = match action {
            Action::Continue => "pldbg_continue",
            Action::StepInto => "pldbg_step_into",
            Action::StepOver => "pldbg_step_over",
            Action::StepOut => {
                let depth = state.frames.len();
                for _ in 0..10000 {
                    self.action(Action::StepOver, state).await?;
                    if state.status != "paused"
                        || state.frames.len() < depth
                        || state.frames.first().is_some_and(|frame| {
                            self.breakpoints
                                .iter()
                                .any(|b| b.oid == frame.oid && b.line == frame.line)
                        })
                    {
                        return Ok(());
                    }
                }
                return Err("Step Out hat das Schrittlimit erreicht.".into());
            }
            Action::Watches { names } => {
                state.watches = names
                    .into_iter()
                    .map(|name| Watch {
                        name,
                        value: None,
                        error: None,
                    })
                    .collect();
                return self.inspect(state, state.selected_frame).await;
            }
            Action::SelectFrame { frame } => {
                self.control
                    .query_one(
                        &self.sql("pldbg_select_frame", "$1, $2"),
                        &[&self.handle, &frame],
                    )
                    .await
                    .map_err(map_pg_err)?;
                return self.inspect(state, frame).await;
            }
            Action::Breakpoints { breakpoints } => {
                self.set_breakpoints(breakpoints).await?;
                return self.inspect(state, state.selected_frame).await;
            }
        };
        let result = self
            .control
            .query_one(&self.sql(function, "$1"), &[&self.handle])
            .await;
        let ended = match result {
            Ok(row) => row.get::<_, Option<u32>>(0).is_none_or(|oid| oid == 0),
            Err(error) => {
                let original = map_pg_err(error);
                let task = self.execution.as_mut().ok_or_else(|| original.clone())?;
                let completion = tokio::time::timeout(Duration::from_secs(1), task)
                    .await
                    .map_err(|_| original)?;
                self.execution.take();
                completion.map_err(|_| "Debug-Ziel unerwartet beendet")??;
                true
            }
        };
        if ended {
            if let Some(task) = self.execution.as_mut() {
                tokio::time::timeout(Duration::from_secs(5), task)
                    .await
                    .map_err(|_| "Debug-Ziel beendet sich nicht")?
                    .map_err(|_| "Debug-Ziel unerwartet beendet")??;
                self.execution.take();
            }
            state.status = "finished".into();
            state.frames.clear();
            state.variables.clear();
            state.message = Some("Ausführung beendet. Offene Transaktion zurückgerollt.".into());
            return Ok(());
        }
        self.inspect(state, 0).await
    }

    async fn stop(&mut self) -> Result<(), String> {
        if self.stopped {
            return Ok(());
        }
        self.stopped = true;
        if self.execution.is_none() {
            return Ok(());
        }
        let _ = self
            .control
            .cancel_token()
            .cancel_query(connection::tls_connector(self.ssl)?)
            .await;
        let _ = self
            .target
            .cancel_token()
            .cancel_query(connection::tls_connector(self.ssl)?)
            .await;
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            self.control
                .simple_query(&self.sql("pldbg_abort_target", &self.handle.to_string())),
        )
        .await;
        if let Some(task) = self.execution.take() {
            task.abort();
        }
        tokio::time::timeout(
            Duration::from_secs(5),
            self.target.batch_execute("ROLLBACK"),
        )
        .await
        .map_err(|_| "Rollback nach Debug-Abbruch hat das Zeitlimit überschritten")?
        .map_err(map_pg_err)
    }
}
