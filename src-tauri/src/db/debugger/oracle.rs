use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use oracle::{sql_type::OracleType, Connection};
use tokio_util::sync::CancellationToken;

use super::{Action, Availability, Backend, Breakpoint, Frame, Launch, Snapshot, Variable, Watch};
use crate::db::{connection, oracle::OracleAdapter, pool::create_pool_state};

fn error(error: oracle::Error) -> String {
    format!("Oracle-Debugger: {error}")
}

async fn connect(url: &str) -> Result<Arc<Connection>, String> {
    let adapter = OracleAdapter::new(
        url,
        create_pool_state(),
        connection::connection_key(url, None),
    )?;
    let mut conn = adapter
        .open_connection()
        .await?
        .into_inner()
        .map_err(|_| "Oracle-Sitzung gesperrt")?;
    conn.set_autocommit(false);
    conn.set_call_timeout(Some(Duration::from_secs(35)))
        .map_err(error)?;
    Ok(Arc::new(conn))
}

pub async fn availability(url: &str) -> Result<Availability, String> {
    let conn = connect(url).await?;
    tokio::task::spawn_blocking(move || {
        let result = conn.execute("DECLARE major BINARY_INTEGER; minor BINARY_INTEGER; BEGIN DBMS_DEBUG.PROBE_VERSION(major, minor); END;", &[]).map_err(error);
        let (count, user) = conn.query_row_as::<(i64, String)>("SELECT COUNT(*), USER FROM session_privs WHERE privilege = 'DEBUG CONNECT SESSION'", &[]).map_err(error)?;
        let privilege = count > 0;
        Ok(Availability {
            available: result.is_ok() && privilege,
            engine: Some("DBMS_DEBUG".into()),
            message: if !privilege { format!("DEBUG CONNECT SESSION fehlt. Ein DBA kann es vergeben: GRANT DEBUG CONNECT SESSION TO {user}; für Objekte anderer Schemas zusätzlich GRANT DEBUG ON <schema>.<objekt> TO {user};") } else { result.err().unwrap_or_else(|| "Oracle DBMS_DEBUG (von Oracle als veraltet markiert). Start kompiliert das gewählte Objekt mit Debug-Informationen. Zwei SQL-Verbindungen, kein JDWP-Rückkanal erforderlich.".into()) },
            step_out: true,
        })
    }).await.map_err(|_| "Oracle-Debug-Prüfung fehlgeschlagen")?
}

fn object(oid: &str) -> Result<(&str, &str, &str), String> {
    let parts: Vec<_> = oid.split('\u{1f}').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || parts[1].is_empty()
        || !matches!(
            parts[2],
            "FUNCTION" | "PROCEDURE" | "PACKAGE BODY" | "PACKAGE"
        )
    {
        return Err("Ungültige Oracle-Debug-Objektreferenz".into());
    }
    Ok((parts[0], parts[1], parts[2]))
}

pub struct OracleDebugger {
    control: Arc<Connection>,
    target: Arc<Connection>,
    execution: Option<tokio::task::JoinHandle<Result<(), String>>>,
    breakpoint_ids: Vec<i32>,
    call: String,
    cancel: CancellationToken,
    stopped: bool,
    line_maps: HashMap<String, Vec<i32>>,
}

impl Drop for OracleDebugger {
    fn drop(&mut self) {
        self.cancel.cancel();
        let control = self.control.clone();
        let target = self.target.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn_blocking(move || {
                let _ = control.break_execution();
                let _ = target.break_execution();
            });
        }
    }
}

pub async fn launch(
    url: &str,
    request: &Launch,
    state: &mut Snapshot,
    cancel: CancellationToken,
) -> Result<OracleDebugger, String> {
    let cancel = cancel.child_token();
    object(&request.oid)?;
    let control = connect(url).await?;
    let target = connect(url).await?;
    if cancel.is_cancelled() {
        return Err("Oracle-Debug-Start abgebrochen.".into());
    }
    let watcher_control = control.clone();
    let watcher_target = target.clone();
    let watcher_cancel = cancel.clone();
    tokio::spawn(async move {
        watcher_cancel.cancelled().await;
        let _ = tokio::task::spawn_blocking(move || {
            let _ = watcher_control.break_execution();
            let _ = watcher_target.break_execution();
        })
        .await;
    });
    let mut backend = OracleDebugger {
        control,
        target,
        execution: None,
        breakpoint_ids: vec![],
        call: request.sql.clone(),
        cancel,
        stopped: false,
        line_maps: HashMap::new(),
    };
    let conn = backend.target.clone();
    let oid = request.oid.clone();
    let debug_id = tokio::task::spawn_blocking(move || {
        let (owner, name, kind) = object(&oid)?;
        let kind = if kind == "PACKAGE BODY" { "PACKAGE" } else { kind };
        let suffix = if kind == "PACKAGE" { " BODY" } else { "" };
        conn.execute(&format!("ALTER {kind} {}.{} COMPILE DEBUG{suffix}", crate::db::oracle::quote(owner), crate::db::oracle::quote(name)), &[]).map_err(error)?;
        let stmt = conn.execute("DECLARE code BINARY_INTEGER; BEGIN :id := DBMS_DEBUG.INITIALIZE; code := DBMS_DEBUG.SET_TIMEOUT(300); DBMS_DEBUG.SET_TIMEOUT_BEHAVIOUR(DBMS_DEBUG.abort_on_timeout); DBMS_DEBUG.DEBUG_ON; END;", &[&OracleType::Varchar2(256)]).map_err(error)?;
        stmt.bind_value::<_, String>(1).map_err(error)
    }).await.map_err(|_| "Oracle-Debug-Initialisierung fehlgeschlagen")??;
    let conn = backend.control.clone();
    tokio::task::spawn_blocking(move || conn.execute("DECLARE code BINARY_INTEGER; BEGIN DBMS_DEBUG.ATTACH_SESSION(:id); code := DBMS_DEBUG.SET_TIMEOUT(30); END;", &[&debug_id]).map(|_| ()).map_err(error)).await.map_err(|_| "Oracle-Debug-Attach fehlgeschlagen")??;
    if backend.cancel.is_cancelled() {
        return Err("Oracle-Debug-Start abgebrochen.".into());
    }
    let target = backend.target.clone();
    let call = backend.call.clone();
    backend.execution = Some(tokio::task::spawn_blocking(move || {
        let result = target.execute(&call, &[]).map(|_| ()).map_err(error);
        let cleanup = target.rollback().map_err(error);
        result.and(cleanup)
    }));
    let conn = backend.control.clone();
    tokio::task::spawn_blocking(move || advance(&conn, None))
        .await
        .map_err(|_| "Oracle-Debug-Synchronisierung fehlgeschlagen")??;
    let skipped = backend.set_breakpoints(request.breakpoints.clone()).await?;
    backend.inspect(state, 0).await?;
    state.message = skipped;
    Ok(backend)
}

fn namespace(kind: &str) -> &'static str {
    if kind == "PACKAGE BODY" {
        "namespace_pkg_body"
    } else {
        "namespace_pkgspec_or_toplevel"
    }
}

fn line_map(conn: &Connection, oid: &str) -> Result<Vec<i32>, String> {
    let (owner, name, kind) = object(oid)?;
    let sql = format!("DECLARE p DBMS_DEBUG.program_info; maxline BINARY_INTEGER; entries BINARY_INTEGER; map RAW(32767); code BINARY_INTEGER; BEGIN p.owner := :owner; p.name := :name; p.namespace := DBMS_DEBUG.{}; code := DBMS_DEBUG.GET_LINE_MAP(p, maxline, entries, map); :map := CASE WHEN code = DBMS_DEBUG.success THEN RAWTOHEX(map) END; END;", namespace(kind));
    let stmt = conn
        .execute(&sql, &[&owner, &name, &OracleType::Varchar2(32767)])
        .map_err(error)?;
    let hex: Option<String> = stmt.bind_value(3).map_err(error)?;
    Ok(executable_lines(hex.as_deref().unwrap_or_default()))
}

fn executable_lines(hex: &str) -> Vec<i32> {
    hex.as_bytes()
        .chunks(2)
        .filter_map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok())
        .enumerate()
        .flat_map(|(index, byte)| {
            (0..8)
                .filter(move |bit| byte & (1 << bit) != 0)
                .map(move |bit| (index * 8 + bit) as i32)
        })
        .filter(|line| *line > 0)
        .collect()
}

fn advance(conn: &Connection, flag: Option<&str>) -> Result<bool, String> {
    let call = match flag {
        Some(flag) => format!("DBMS_DEBUG.CONTINUE(info, {flag})"),
        None => "DBMS_DEBUG.SYNCHRONIZE(info)".into(),
    };
    let sql = format!("DECLARE info DBMS_DEBUG.runtime_info; code BINARY_INTEGER; BEGIN code := {call}; IF code <> DBMS_DEBUG.success THEN raise_application_error(-20001, 'Debug-Status ' || code); END IF; :ended := NVL(info.terminated, 0); END;");
    let stmt = conn.execute(&sql, &[&OracleType::Int64]).map_err(error)?;
    Ok(stmt.bind_value::<_, i32>(1).map_err(error)? != 0)
}

impl OracleDebugger {
    async fn set_breakpoints(
        &mut self,
        breakpoints: Vec<Breakpoint>,
    ) -> Result<Option<String>, String> {
        for breakpoint in &breakpoints {
            object(&breakpoint.oid)?;
        }
        let conn = self.control.clone();
        let old = std::mem::take(&mut self.breakpoint_ids);
        let (ids, skipped) = tokio::task::spawn_blocking(move || {
            for id in old { conn.execute("DECLARE code BINARY_INTEGER; BEGIN code := DBMS_DEBUG.DELETE_BREAKPOINT(:id); END;", &[&id]).map_err(error)?; }
            let mut ids = vec![];
            let mut skipped = vec![];
            for breakpoint in breakpoints {
                let (owner, name, kind) = object(&breakpoint.oid)?;
                let sql = format!("DECLARE p DBMS_DEBUG.program_info; code BINARY_INTEGER; BEGIN p.owner := :owner; p.name := :name; p.namespace := DBMS_DEBUG.{}; code := DBMS_DEBUG.SET_BREAKPOINT(p, :line, :id); IF code = DBMS_DEBUG.error_illegal_line THEN :id := -1; ELSIF code <> DBMS_DEBUG.success THEN raise_application_error(-20001, 'Breakpoint-Status ' || code); END IF; END;", namespace(kind));
                let stmt = conn.execute(&sql, &[&owner, &name, &breakpoint.line, &OracleType::Int64]).map_err(error)?;
                match stmt.bind_value::<_, i32>(4).map_err(error)? {
                    -1 => skipped.push(format!("{name}:{}", breakpoint.line)),
                    id => ids.push(id),
                }
            }
            Ok::<_, String>((ids, skipped))
        }).await.map_err(|_| "Oracle-Breakpoints fehlgeschlagen")??;
        self.breakpoint_ids = ids;
        Ok((!skipped.is_empty()).then(|| {
            format!(
                "Breakpoint übersprungen, die Zeile enthält keine ausführbare Anweisung: {}",
                skipped.join(", ")
            )
        }))
    }

    async fn inspect(&mut self, state: &mut Snapshot, selected: i32) -> Result<(), String> {
        let conn = self.control.clone();
        let call = self.call.clone();
        let watches = state.watches.clone();
        let known: Vec<String> = self.line_maps.keys().cloned().collect();
        let (frames, source, variables, selected, watches, line_map) = tokio::task::spawn_blocking(move || {
            let sql = "DECLARE bt DBMS_DEBUG.backtrace_table; items JSON_ARRAY_T := JSON_ARRAY_T(); item JSON_OBJECT_T; idx BINARY_INTEGER; kind VARCHAR2(30); BEGIN DBMS_DEBUG.PRINT_BACKTRACE(bt); idx := bt.LAST; WHILE idx IS NOT NULL LOOP item := JSON_OBJECT_T(); IF bt(idx).namespace = DBMS_DEBUG.namespace_pkg_body THEN kind := 'PACKAGE BODY'; ELSIF bt(idx).libunittype = DBMS_DEBUG.LibunitType_function THEN kind := 'FUNCTION'; ELSE kind := 'PROCEDURE'; END IF; item.put('id', idx); item.put('oid', bt(idx).owner || CHR(31) || bt(idx).name || CHR(31) || kind); item.put('name', NVL(bt(idx).owner || '.', '') || NVL(bt(idx).name, 'Aufrufskript')); item.put('line', NVL(bt(idx).line#, 1)); items.append(item); idx := bt.PRIOR(idx); END LOOP; :result := items.to_string; END;";
            let stmt = conn.execute(sql, &[&OracleType::Varchar2(32767)]).map_err(error)?;
            let json: String = stmt.bind_value(1).map_err(error)?;
            let frames: Vec<Frame> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            let frame = frames.iter().find(|f| f.id == selected).or_else(|| frames.first());
            let selected = frame.map_or(0, |f| f.id);
            let line_map = frame.filter(|f| !known.contains(&f.oid) && object(&f.oid).is_ok()).map(|f| (f.oid.clone(), line_map(&conn, &f.oid).unwrap_or_default()));
            let frame_oid = frame.map(|f| f.oid.clone());
            let source = if let Some((owner, name, kind)) = frame.and_then(|f| object(&f.oid).ok()) {
                let mut source = String::new();
                for row in conn.query("SELECT text FROM all_source WHERE owner = :1 AND name = :2 AND type = :3 ORDER BY line", &[&owner, &name, &kind]).map_err(error)? {
                    source.push_str(&row.map_err(error)?.get::<_, String>(0).map_err(error)?);
                }
                if source.is_empty() { call } else { source }
            } else { call };
            let identifiers = regex::Regex::new(r"(?i)\b([a-z][a-z0-9_$#]*)\s+(?:(?:IN|OUT|INOUT|CONSTANT)\s+)*(?:NUMBER|INTEGER|PLS_INTEGER|BINARY_INTEGER|VARCHAR2|CHAR|DATE|TIMESTAMP|BOOLEAN|[a-z][a-z0-9_$#.]*%TYPE)\b").map_err(|e| e.to_string())?;
            let mut variables: Vec<Variable> = vec![];
            for capture in identifiers.captures_iter(&source).take(200) {
                let name = capture[1].to_string();
                if variables.iter().any(|v| v.name.eq_ignore_ascii_case(&name)) { continue; }
                let stmt = conn.execute("DECLARE code BINARY_INTEGER; val VARCHAR2(32767); BEGIN code := DBMS_DEBUG.GET_VALUE(:name, :frame, val); :value := val; :ok := CASE WHEN code IN (DBMS_DEBUG.success, DBMS_DEBUG.error_nullvalue) THEN 1 ELSE 0 END; END;", &[&name, &selected, &OracleType::Varchar2(32767), &OracleType::Int64]).map_err(error)?;
                if stmt.bind_value::<_, i32>(4).map_err(error)? == 1 {
                    variables.push(Variable { name, value: stmt.bind_value(3).map_err(error)?, datatype: "PL/SQL".into() });
                }
            }
            let watches = watches.into_iter().map(|watch| {
                let result = conn.execute("DECLARE code BINARY_INTEGER; val VARCHAR2(32767); BEGIN code := DBMS_DEBUG.GET_VALUE(:name, :frame, val); :value := val; :code := CASE WHEN code = DBMS_DEBUG.error_nullvalue THEN 0 ELSE code END; END;", &[&watch.name, &selected, &OracleType::Varchar2(32767), &OracleType::Int64]).map_err(error).and_then(|stmt| {
                    let code: i32 = stmt.bind_value(4).map_err(error)?;
                    if code != 0 { return Err(format!("Variable nicht lesbar (Debug-Status {code}).")); }
                    stmt.bind_value::<_, Option<String>>(3).map_err(error)
                });
                match result { Ok(value) => Watch { name: watch.name, value, error: None }, Err(error) => Watch { name: watch.name, value: None, error: Some(error) } }
            }).collect();
            Ok::<_, String>((frames, source, variables, selected, watches, (frame_oid, line_map)))
        }).await.map_err(|_| "Oracle-Debug-Inspektion fehlgeschlagen")??;
        let (frame_oid, line_map) = line_map;
        if let Some((oid, lines)) = line_map {
            self.line_maps.insert(oid, lines);
        }
        state.executable_lines = frame_oid
            .and_then(|oid| self.line_maps.get(&oid).cloned())
            .unwrap_or_default();
        state.watches = watches;
        state.frames = frames;
        state.source = source;
        state.variables = variables;
        state.selected_frame = selected;
        state.status = "paused".into();
        state.message = None;
        Ok(())
    }
}

#[async_trait]
impl Backend for OracleDebugger {
    async fn action(&mut self, action: Action, state: &mut Snapshot) -> Result<(), String> {
        let flag = match action {
            Action::Continue => "DBMS_DEBUG.break_exception",
            Action::StepInto => "DBMS_DEBUG.break_any_call + DBMS_DEBUG.break_exception",
            Action::StepOver => "DBMS_DEBUG.break_next_line + DBMS_DEBUG.break_exception",
            Action::StepOut => "DBMS_DEBUG.break_any_return + DBMS_DEBUG.break_exception",
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
            Action::SelectFrame { frame } => return self.inspect(state, frame).await,
            Action::SetValue { name, value } => {
                let conn = self.control.clone();
                let frame = state.selected_frame;
                let assignment = format!("{name} := {value};");
                let failure = tokio::task::spawn_blocking(move || {
                    let stmt = conn.execute("DECLARE code BINARY_INTEGER; BEGIN code := DBMS_DEBUG.SET_VALUE(:frame, :assignment); :message := CASE WHEN code = DBMS_DEBUG.success THEN NULL WHEN code = DBMS_DEBUG.error_illegal_value THEN 'Der Wert passt nicht zum Datentyp oder verletzt eine Einschränkung.' WHEN code = DBMS_DEBUG.error_illegal_null THEN 'Die Variable ist NOT NULL.' WHEN code = DBMS_DEBUG.error_value_malformed THEN 'Der Ausdruck ist kein gültiger Wert, z. B. 42, ''Text'' oder NULL.' WHEN code = DBMS_DEBUG.error_name_incomplete THEN 'Bei Records und Collections das Feld oder Element angeben.' ELSE 'Debug-Status ' || code END; END;", &[&frame, &assignment, &OracleType::Varchar2(512)]).map_err(error)?;
                    stmt.bind_value::<_, Option<String>>(3).map_err(error)
                })
                .await
                .map_err(|_| "Oracle-Debug-Wert setzen fehlgeschlagen")?
                .unwrap_or_else(Some);
                self.inspect(state, frame).await?;
                state.message =
                    failure.map(|reason| format!("{name} wurde nicht geändert: {reason}"));
                return Ok(());
            }
            Action::Breakpoints { breakpoints } => {
                let skipped = self.set_breakpoints(breakpoints).await?;
                self.inspect(state, state.selected_frame).await?;
                state.message = skipped;
                return Ok(());
            }
        };
        let conn = self.control.clone();
        let ended = tokio::task::spawn_blocking(move || advance(&conn, Some(flag)))
            .await
            .map_err(|_| "Oracle-Debug-Schritt fehlgeschlagen")??;
        if ended {
            if let Some(task) = self.execution.take() {
                task.await.map_err(|_| "Oracle-Debug-Ziel beendet")??;
            }
            state.status = "finished".into();
            state.frames.clear();
            state.variables.clear();
            state.message = Some("Ausführung beendet. Offene Transaktion zurückgerollt.".into());
            Ok(())
        } else {
            self.inspect(state, 0).await
        }
    }

    async fn stop(&mut self) -> Result<(), String> {
        if self.stopped {
            return Ok(());
        }
        self.stopped = true;
        if self.execution.is_none() {
            return Ok(());
        }
        self.cancel.cancel();
        let control = self.control.clone();
        let target = self.target.clone();
        tokio::task::spawn_blocking(move || {
            let _ = control.break_execution();
            let _ = target.break_execution();
            let _ = advance(&control, Some("DBMS_DEBUG.abort_execution"));
            let _ = control.execute("BEGIN DBMS_DEBUG.DETACH_SESSION; END;", &[]);
        })
        .await
        .map_err(|_| "Oracle-Debug-Abbruch fehlgeschlagen")?;
        if let Some(task) = self.execution.take() {
            let _ = tokio::time::timeout(Duration::from_secs(35), task)
                .await
                .map_err(|_| "Oracle-Debug-Ziel reagiert nicht auf Abbruch")?;
        }
        Ok(())
    }
}
