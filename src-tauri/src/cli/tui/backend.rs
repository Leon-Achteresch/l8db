use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::grid::clean;
use super::model::{Banner, Object, Request, Response, MAX_ROWS, PAGE};
use super::terminal::worker_panic;
use crate::automation::model::AutomationConnection;
use crate::cli::connect::{self, Session, Source, Target};
use crate::cli::output;
use crate::cli::run::{
    changed, guarded, kind_name, prepare, relations, run_prepared, Approval, RunOptions, Step,
    ABORTED, CONFIRM_REQUIRED,
};
use crate::cli::Limit;
use crate::db::{execution, QueryResult};

const TIMEOUT: u64 = 300;
const DROPPED: &str = "Abgebrochen. Die Datenbank führt eine laufende Anweisung möglicherweise noch zu Ende; die Verbindung wird neu aufgebaut.";

enum Origin {
    Saved(usize),
    Url(String),
}

pub struct Backend {
    database: Option<String>,
    job: String,
    list: Vec<AutomationConnection>,
    origin: Mutex<Option<Origin>>,
    session: Mutex<Option<Arc<Session>>>,
    task: Mutex<Option<tokio::task::AbortHandle>>,
    cancelling: AtomicBool,
}

fn cells(columns: &[String], rows: &[Value]) -> Vec<Vec<String>> {
    rows.iter()
        .map(|row| {
            columns
                .iter()
                .enumerate()
                .map(|(index, column)| {
                    let value = match row {
                        Value::Object(map) => map.get(column),
                        Value::Array(list) => list.get(index),
                        other => Some(other),
                    };
                    clean(&output::table_text(value.unwrap_or(&Value::Null)))
                })
                .collect()
        })
        .collect()
}

impl Backend {
    pub fn new(database: Option<String>, list: Vec<AutomationConnection>) -> Self {
        Backend {
            database,
            job: format!("tui-{}", std::process::id()),
            list,
            origin: Mutex::new(None),
            session: Mutex::new(None),
            task: Mutex::new(None),
            cancelling: AtomicBool::new(false),
        }
    }

    pub async fn perform(self: Arc<Self>, request: Request) -> Response {
        self.cancelling.store(false, Ordering::Release);
        let dropped_statement = !matches!(request, Request::Open(_));
        let worker = self.clone();
        let handle = tokio::spawn(async move { worker.work(request).await });
        if let Ok(mut task) = self.task.lock() {
            *task = Some(handle.abort_handle());
        }
        let outcome = handle.await;
        let detail = worker_panic()
            .map(|detail| format!("\n{detail}"))
            .unwrap_or_default();
        match outcome {
            Ok(Ok(response)) => response,
            Ok(Err(error)) if error == CONFIRM_REQUIRED => Response::Confirm,
            Ok(Err(error)) => Response::Failed(format!("{error}{detail}")),
            Err(error) if error.is_cancelled() => {
                if let Ok(mut session) = self.session.lock() {
                    *session = None;
                }
                Response::Failed(if dropped_statement { DROPPED } else { ABORTED }.into())
            }
            Err(error) => Response::Failed(format!("Interner Fehler: {error}{detail}")),
        }
    }

    pub fn cancel(&self) {
        let first = !self.cancelling.swap(true, Ordering::AcqRel);
        if first && matches!(execution::cancel(&self.job), Ok(true)) {
            return;
        }
        if let Some(task) = self.task.lock().ok().and_then(|task| task.clone()) {
            task.abort();
        }
    }

    async fn current(&self) -> Result<Arc<Session>, String> {
        let open = self.session.lock().ok().and_then(|session| session.clone());
        if let Some(session) = open {
            return Ok(session);
        }
        let source = match self.origin.lock().ok().as_deref() {
            Some(Some(Origin::Saved(index))) => self.saved(*index)?,
            Some(Some(Origin::Url(url))) => connect::ad_hoc(url)?,
            _ => return Err("Keine Verbindung geöffnet.".into()),
        };
        self.connect(source).await
    }

    fn saved(&self, index: usize) -> Result<Source, String> {
        let found = self.list.get(index).ok_or("Verbindung nicht gefunden.")?;
        Ok(Source::Saved(Target::saved(found)))
    }

    async fn connect(&self, source: Source) -> Result<Arc<Session>, String> {
        let origin = match &source {
            Source::Saved(target) => self
                .list
                .iter()
                .position(|connection| connection.id == target.id)
                .map(Origin::Saved),
            Source::Url { url, .. } => Some(Origin::Url(url.clone())),
        };
        let session = Arc::new(connect::open(source, self.database.as_deref()).await?);
        if let Ok(mut current) = self.origin.lock() {
            *current = origin;
        }
        if let Ok(mut current) = self.session.lock() {
            *current = Some(session.clone());
        }
        Ok(session)
    }

    pub async fn open(&self, source: Source) -> Result<Response, String> {
        let session = self.connect(source).await?;
        let objects = relations(&session, None, &self.job)
            .await?
            .into_iter()
            .map(|relation| Object {
                schema: relation.schema,
                name: relation.name,
                view: relation.view,
            })
            .collect();
        let banner = Banner {
            name: clean(&session.target.name),
            kind: kind_name(session.target.kind),
            production: session.target.production,
            read_only: session.target.read_only,
        };
        Ok(Response::Opened { banner, objects })
    }

    async fn work(&self, request: Request) -> Result<Response, String> {
        match request {
            Request::Open(index) => self.open(self.saved(index)?).await,
            Request::Rows { object, offset } => {
                let session = self.current().await?;
                let data = guarded(
                    &self.job,
                    session.target.kind,
                    TIMEOUT,
                    session.adapter.fetch_rows(
                        &object.schema,
                        &object.name,
                        None,
                        PAGE as i64,
                        offset as i64,
                        None,
                        false,
                        object.view,
                        false,
                    ),
                )
                .await?;
                Ok(Response::Rows {
                    rows: cells(&data.columns, &data.rows),
                    columns: data.columns,
                    object,
                    offset,
                })
            }
            Request::Columns(object) => {
                let session = self.current().await?;
                let columns = guarded(
                    &self.job,
                    session.target.kind,
                    60,
                    session
                        .adapter
                        .list_columns(Some(&object.schema), Some(&object.name), None),
                )
                .await?;
                Ok(Response::Columns {
                    rows: columns
                        .iter()
                        .map(|column| vec![clean(&column.name), clean(&column.data_type)])
                        .collect(),
                    object,
                })
            }
            Request::Run { sql, answer } => self.run(&sql, answer).await,
        }
    }

    async fn run(&self, sql: &str, answer: Option<String>) -> Result<Response, String> {
        let session = self.current().await?;
        let mut notes: Vec<String> = Vec::new();
        let prepared = prepare(&session.target, sql, Approval::Typed(answer), &mut |note| {
            notes.push(note)
        })
        .await?;
        let options = RunOptions {
            limit: Limit {
                limit: MAX_ROWS,
                all: false,
            },
            timeout: TIMEOUT,
            no_transaction: false,
            typed: false,
        };
        let begun = Instant::now();
        let mut shown: Option<QueryResult> = None;
        let mut count = 0;
        let mut last = String::new();
        run_prepared(
            &session,
            self.database.as_deref(),
            &prepared,
            &options,
            &self.job,
            &mut |step| {
                match step {
                    Step::Result { result, .. } => {
                        count += 1;
                        if result.columns.is_empty() {
                            last = format!("✓ {}", changed(&result));
                        } else {
                            let rows = result.rows.len();
                            last = match (result.truncated, rows) {
                                (true, _) => format!("Erste {rows} Zeilen"),
                                (false, 1) => "1 Zeile".to_string(),
                                (false, _) => format!("{rows} Zeilen"),
                            };
                            shown = Some(result);
                        }
                    }
                    Step::Note(note) => notes.push(note),
                }
                Ok(())
            },
        )
        .await?;
        let mut status = if count > 1 {
            format!("{count} Anweisungen · {last}")
        } else {
            last
        };
        status.push_str(&format!(" · {} ms", begun.elapsed().as_millis()));
        for note in notes {
            status.push_str(" · ");
            status.push_str(&clean(&note));
        }
        let grid = shown.map(|result| {
            let rows = cells(&result.columns, &result.rows);
            (result.columns, rows)
        });
        Ok(Response::Results { grid, status })
    }
}
