use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

use super::crypto::{self, Decryptor, Digests, Encryptor};
use super::jobs::{Job, CANCELLED};
use super::mask::Masker;
use super::vault::Vault;
use crate::db::backup::EnvVars;
use crate::db::backup_tools;

const BLOCK: usize = 256 * 1024;
const TAIL: usize = 40;
const DUMP_COMPLETE: &[u8] = b"PostgreSQL database dump complete";

#[derive(Clone)]
pub struct Tool {
    pub path: PathBuf,
    pub version: String,
    pub restrict: bool,
    pub statistics: bool,
}

#[derive(Clone)]
pub struct Tools {
    pub dump: Tool,
    pub restore: Tool,
    pub psql: Tool,
}

async fn help(path: &Path) -> String {
    backup_tools::command(path)
        .arg("--help")
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
}

async fn tool(
    name: &'static str,
    paths: &HashMap<String, String>,
    server_major: u32,
) -> Result<Tool, String> {
    let info = backup_tools::locate_one(name, paths).await?;
    let path = PathBuf::from(info.path.clone().unwrap_or_default());
    if name != "psql" {
        if let Some(major) = info.major.filter(|major| *major < server_major) {
            return Err(format!(
                "{name} {major} ist älter als der Server ({server_major}). Mindestens Version {server_major} installieren oder den Pfad unter „Sichern & Wiederherstellen → Werkzeuge“ setzen."
            ));
        }
    }
    let text = help(&path).await;
    Ok(Tool {
        version: info.version.unwrap_or_default(),
        restrict: text.contains("--restrict-key"),
        statistics: text.contains("--no-statistics"),
        path,
    })
}

pub async fn tools(paths: &HashMap<String, String>, server_major: u32) -> Result<Tools, String> {
    Ok(Tools {
        dump: tool("pg_dump", paths, server_major).await?,
        restore: tool("pg_restore", paths, server_major).await?,
        psql: tool("psql", paths, server_major).await?,
    })
}

pub fn env(connection_string: &str, database: &str) -> Result<(EnvVars, Vec<String>), String> {
    let (mut env, secrets) = crate::db::backup::pg_env(connection_string, Some(database))?;
    env.retain(|(key, _)| key != "PGAPPNAME");
    env.push(("PGAPPNAME".into(), "l8db-branching".into()));
    Ok((env, secrets))
}

fn redact(line: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| secret.len() >= 3)
        .fold(line.to_string(), |acc, secret| {
            acc.replace(secret.as_str(), "••••")
        })
}

pub struct Running {
    child: Child,
    name: String,
    tail: Arc<Mutex<VecDeque<String>>>,
    reader: tokio::task::JoinHandle<()>,
}

impl Running {
    pub fn spawn(
        job: &Job,
        program: &Path,
        args: &[String],
        env: &[(String, String)],
        secrets: &[String],
        stdin: bool,
        stdout: bool,
    ) -> Result<Self, String> {
        let name = program
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| program.display().to_string());
        job.log(format!("$ {name} {}", args.join(" ")));
        let mut command = backup_tools::command(program);
        command
            .args(args)
            .stdin(if stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(if stdout {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (key, value) in env {
            command.env(key, value);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("{name} konnte nicht gestartet werden: {error}"))?;
        let tail = Arc::new(Mutex::new(VecDeque::with_capacity(TAIL)));
        let stderr = child.stderr.take().ok_or("Fehlerausgabe nicht verfügbar")?;
        let secrets = secrets.to_vec();
        let lines = tail.clone();
        let log = job.clone();
        let prefix = name.clone();
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let line = redact(line.trim_end(), &secrets);
                if line.is_empty() {
                    continue;
                }
                log.log(format!("{prefix}: {line}"));
                if let Ok(mut tail) = lines.lock() {
                    if tail.len() == TAIL {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            }
        });
        Ok(Self {
            child,
            name,
            tail,
            reader,
        })
    }

    fn stdout(&mut self) -> Result<ChildStdout, String> {
        self.child
            .stdout
            .take()
            .ok_or_else(|| format!("{}: Ausgabe nicht verfügbar", self.name))
    }

    fn stdin(&mut self) -> Result<ChildStdin, String> {
        self.child
            .stdin
            .take()
            .ok_or_else(|| format!("{}: Eingabe nicht verfügbar", self.name))
    }

    fn kill(&mut self) {
        let _ = self.child.start_kill();
    }

    pub async fn finish(mut self) -> Result<(), String> {
        let status = self.child.wait().await.map_err(|error| error.to_string())?;
        let _ = self.reader.await;
        if status.success() {
            return Ok(());
        }
        let tail: Vec<String> = self
            .tail
            .lock()
            .map(|tail| tail.iter().rev().take(12).rev().cloned().collect())
            .unwrap_or_default();
        Err(format!(
            "{} ist fehlgeschlagen ({}).\n{}",
            self.name,
            status
                .code()
                .map(|code| format!("Code {code}"))
                .unwrap_or_else(|| "abgebrochen".into()),
            tail.join("\n")
        ))
    }
}

enum Fault {
    Read(String),
    Write(String),
    Logic(String),
}

impl Fault {
    fn text(self) -> String {
        match self {
            Fault::Read(text) | Fault::Write(text) | Fault::Logic(text) => text,
        }
    }
}

type Step<'a> = Box<dyn FnMut(&[u8], &mut Vec<u8>) -> Result<(), String> + Send + 'a>;
type Finish<'a> = Box<dyn FnOnce(&mut Vec<u8>) -> Result<(), String> + Send + 'a>;

async fn pump<R, W>(
    mut reader: R,
    mut writer: W,
    mut step: Step<'_>,
    finish: Finish<'_>,
    job: &Job,
    total: u64,
) -> Result<W, Fault>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = vec![0u8; BLOCK];
    let mut out = Vec::with_capacity(BLOCK * 2);
    let mut done = 0u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| Fault::Read(format!("Lesefehler: {error}")))?;
        if read == 0 {
            break;
        }
        out.clear();
        step(&buffer[..read], &mut out).map_err(Fault::Logic)?;
        writer
            .write_all(&out)
            .await
            .map_err(|error| Fault::Write(format!("Schreibfehler: {error}")))?;
        done += read as u64;
        job.progress(done, total);
    }
    out.clear();
    finish(&mut out).map_err(Fault::Logic)?;
    writer
        .write_all(&out)
        .await
        .and(writer.flush().await)
        .map_err(|error| Fault::Write(format!("Schreibfehler: {error}")))?;
    job.progress(done, total.max(done));
    Ok(writer)
}

fn passthrough<'a>() -> (Step<'a>, Finish<'a>) {
    (
        Box::new(|data, out| {
            out.extend_from_slice(data);
            Ok(())
        }),
        Box::new(|_| Ok(())),
    )
}

fn masking<'a>(masker: &'a mut Masker) -> (Step<'a>, Finish<'a>) {
    let shared = Arc::new(Mutex::new((masker, VecDeque::<u8>::with_capacity(512))));
    let feed = shared.clone();
    (
        Box::new(move |data, out| {
            let mut guard = feed
                .lock()
                .map_err(|_| "Maskierung blockiert".to_string())?;
            let (masker, tail) = &mut *guard;
            let start = out.len();
            masker.feed(data, out)?;
            for byte in &out[start..] {
                if tail.len() == 512 {
                    tail.pop_front();
                }
                tail.push_back(*byte);
            }
            Ok(())
        }),
        Box::new(move |out| {
            let mut guard = shared
                .lock()
                .map_err(|_| "Maskierung blockiert".to_string())?;
            let (masker, tail) = &mut *guard;
            let start = out.len();
            masker.finish(out)?;
            tail.extend(out[start..].iter().copied());
            let tail: Vec<u8> = tail.iter().copied().collect();
            if !tail
                .windows(DUMP_COMPLETE.len())
                .any(|window| window == DUMP_COMPLETE)
            {
                return Err("Der SQL-Datenstrom ist unvollständig; Branch wird verworfen.".into());
            }
            Ok(())
        }),
    )
}

fn decrypting<'a>(
    decryptor: Decryptor,
    digests: &'a Mutex<Option<Digests>>,
) -> (Step<'a>, Finish<'a>) {
    let state = Arc::new(Mutex::new(Some(decryptor)));
    let feed = state.clone();
    (
        Box::new(move |data, out| {
            feed.lock()
                .map_err(|_| "Entschlüsselung blockiert".to_string())?
                .as_mut()
                .ok_or("Entschlüsselung beendet")?
                .update(data, out)
        }),
        Box::new(move |out| {
            let decryptor = state
                .lock()
                .map_err(|_| "Entschlüsselung blockiert".to_string())?
                .take()
                .ok_or("Entschlüsselung beendet")?;
            let result = decryptor.finish(out)?;
            *digests
                .lock()
                .map_err(|_| "Prüfsumme blockiert".to_string())? = Some(result);
            Ok(())
        }),
    )
}

async fn cancellable<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
    on_cancel: impl FnOnce(),
) -> Result<T, String> {
    let token = crate::db::execution::cancellation_token();
    tokio::select! {
        result = future => result,
        _ = token.cancelled() => {
            on_cancel();
            Err(CANCELLED.into())
        }
    }
}

async fn open_encrypted(
    vault: &Vault,
    path: &Path,
) -> Result<(tokio::fs::File, Decryptor, u64), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("Tresordatei nicht lesbar: {error}"))?;
    let size = file.metadata().await.map(|meta| meta.len()).unwrap_or(0);
    let mut header = vec![0u8; crypto::HEADER_LEN];
    file.read_exact(&mut header)
        .await
        .map_err(|_| "Tresordatei ist unvollständig".to_string())?;
    let decryptor = Decryptor::new(vault.keys.file.as_ref(), &vault.keys.key_id, &header)?;
    Ok((file, decryptor, size))
}

fn expect_digests(found: &Mutex<Option<Digests>>, expected: &Digests) -> Result<(), String> {
    let found = found
        .lock()
        .map_err(|_| "Prüfsumme blockiert".to_string())?
        .clone()
        .ok_or("Prüfsumme fehlt")?;
    if found.plain_sha256 != expected.plain_sha256 || found.cipher_sha256 != expected.cipher_sha256
    {
        return Err(
            "Integritätsprüfung fehlgeschlagen: Inhalt weicht vom signierten Manifest ab.".into(),
        );
    }
    Ok(())
}

pub async fn dump_to_vault(
    job: &Job,
    vault: &Vault,
    mut dump: Running,
    path: &Path,
) -> Result<Digests, String> {
    let stdout = dump.stdout()?;
    let file = tokio::fs::File::create(path)
        .await
        .map_err(|error| format!("Tresordatei konnte nicht angelegt werden: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    let (encryptor, header) = Encryptor::new(vault.keys.file.as_ref(), &vault.keys.key_id)?;
    let digests = Arc::new(Mutex::new(None));
    let state = Arc::new(Mutex::new(Some(encryptor)));
    let feed = state.clone();
    let result_slot = digests.clone();
    let mut first = Some(header);
    let step: Step = Box::new(move |data, out| {
        if let Some(header) = first.take() {
            out.extend_from_slice(&header);
        }
        feed.lock()
            .map_err(|_| "Verschlüsselung blockiert".to_string())?
            .as_mut()
            .ok_or("Verschlüsselung beendet")?
            .update(data, out)
    });
    let finish: Finish = Box::new(move |out| {
        let encryptor = state
            .lock()
            .map_err(|_| "Verschlüsselung blockiert".to_string())?
            .take()
            .ok_or("Verschlüsselung beendet")?;
        *result_slot
            .lock()
            .map_err(|_| "Prüfsumme blockiert".to_string())? = Some(encryptor.finish(out)?);
        Ok(())
    });
    let outcome = cancellable(
        async {
            match pump(stdout, file, step, finish, job, 0).await {
                Ok(file) => {
                    let dumped = dump.finish().await;
                    file.sync_all().await.map_err(|error| error.to_string())?;
                    dumped
                }
                Err(fault) => {
                    dump.kill();
                    let _ = dump.finish().await;
                    Err(fault.text())
                }
            }
        },
        || {},
    )
    .await;
    if let Err(error) = outcome {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    let digests = digests
        .lock()
        .map_err(|_| "Prüfsumme blockiert".to_string())?
        .clone()
        .ok_or("Prüfsumme fehlt")?;
    if digests.plain_bytes == 0 {
        let _ = std::fs::remove_file(path);
        return Err("pg_dump hat keine Daten geliefert.".into());
    }
    Ok(digests)
}

struct Pending {
    stdin: ChildStdin,
    sink: Running,
}

impl Pending {
    async fn commit(self) -> Result<(), String> {
        drop(self.stdin);
        self.sink.finish().await
    }

    async fn abort(mut self) {
        self.sink.kill();
        drop(self.stdin);
        let _ = self.sink.finish().await;
    }
}

async fn into_sink<R: AsyncRead + Unpin>(
    job: &Job,
    reader: R,
    (step, finish): (Step<'_>, Finish<'_>),
    mut sink: Running,
    total: u64,
) -> Result<Pending, String> {
    let stdin = sink.stdin()?;
    match pump(reader, stdin, step, finish, job, total).await {
        Ok(stdin) => Ok(Pending { stdin, sink }),
        Err(fault) => {
            let write_fault = matches!(fault, Fault::Write(_));
            sink.kill();
            match (write_fault, sink.finish().await) {
                (true, Err(error)) => Err(error),
                _ => Err(fault.text()),
            }
        }
    }
}

async fn settle(
    pending: Result<Pending, String>,
    checks: Vec<Result<(), String>>,
) -> Result<(), String> {
    let pending = pending?;
    if let Some(error) = checks.into_iter().find_map(Result::err) {
        pending.abort().await;
        return Err(error);
    }
    pending.commit().await
}

pub async fn dump_into(
    job: &Job,
    mut dump: Running,
    sink: Running,
    masker: Option<&mut Masker>,
) -> Result<(), String> {
    let stdout = dump.stdout()?;
    let steps = match masker {
        Some(masker) => masking(masker),
        None => passthrough(),
    };
    let dump = Arc::new(Mutex::new(Some(dump)));
    let killer = dump.clone();
    cancellable(
        async {
            let pending = into_sink(job, stdout, steps, sink, 0).await;
            let taken = dump.lock().ok().and_then(|mut slot| slot.take());
            let Some(mut process) = taken else {
                return Err(CANCELLED.into());
            };
            if pending.is_err() {
                process.kill();
            }
            let dumped = process.finish().await;
            settle(pending, vec![dumped]).await
        },
        move || {
            if let Some(process) = killer.lock().ok().and_then(|mut slot| slot.take()) {
                drop(process);
            }
        },
    )
    .await
}

pub async fn vault_into(
    job: &Job,
    vault: &Vault,
    path: &Path,
    expected: &Digests,
    sink: Running,
) -> Result<(), String> {
    let (file, decryptor, size) = open_encrypted(vault, path).await?;
    let digests = Mutex::new(None);
    cancellable(
        async {
            let pending = into_sink(job, file, decrypting(decryptor, &digests), sink, size).await;
            let verified = if pending.is_ok() {
                expect_digests(&digests, expected)
            } else {
                Ok(())
            };
            settle(pending, vec![verified]).await
        },
        || {},
    )
    .await
}

pub async fn vault_through(
    job: &Job,
    vault: &Vault,
    path: &Path,
    expected: &Digests,
    mut middle: Running,
    sink: Running,
    masker: &mut Masker,
) -> Result<(), String> {
    let (file, decryptor, size) = open_encrypted(vault, path).await?;
    let digests = Mutex::new(None);
    let middle_in = middle.stdin()?;
    let middle_out = middle.stdout()?;
    let middle = Arc::new(Mutex::new(Some(middle)));
    let kill_middle = || {
        if let Ok(mut slot) = middle.lock() {
            if let Some(process) = slot.as_mut() {
                process.kill();
            }
        }
    };
    cancellable(
        async {
            let feed = async {
                let steps = decrypting(decryptor, &digests);
                let outcome = match pump(file, middle_in, steps.0, steps.1, job, size).await {
                    Ok(stdin) => expect_digests(&digests, expected).map(|_| stdin),
                    Err(fault) => Err(fault.text()),
                };
                match outcome {
                    Ok(stdin) => {
                        drop(stdin);
                        Ok(())
                    }
                    Err(error) => {
                        kill_middle();
                        Err(error)
                    }
                }
            };
            let drain = async {
                let pending = into_sink(job, middle_out, masking(masker), sink, 0).await;
                if pending.is_err() {
                    kill_middle();
                }
                pending
            };
            let (fed, pending) = tokio::join!(feed, drain);
            let taken = middle.lock().ok().and_then(|mut slot| slot.take());
            let converted = match taken {
                Some(process) => process.finish().await,
                None => Err(CANCELLED.into()),
            };
            settle(pending, vec![fed, converted]).await
        },
        || kill_middle(),
    )
    .await
}

pub async fn collect(job: &Job, mut dump: Running, limit: usize) -> Result<String, String> {
    let mut stdout = dump.stdout()?;
    let mut out = Vec::new();
    let mut buffer = vec![0u8; BLOCK];
    let read = cancellable(
        async {
            loop {
                let read = stdout
                    .read(&mut buffer)
                    .await
                    .map_err(|error| error.to_string())?;
                if read == 0 {
                    return Ok(());
                }
                if out.len() + read > limit {
                    return Err("Das Schema ist zu groß für den Vergleich.".to_string());
                }
                out.extend_from_slice(&buffer[..read]);
                job.progress(out.len() as u64, 0);
            }
        },
        || {},
    )
    .await;
    if read.is_err() {
        dump.kill();
    }
    let finished = dump.finish().await;
    read?;
    finished?;
    String::from_utf8(out).map_err(|_| "Schema ist kein gültiges UTF-8.".into())
}

pub async fn read_vault(
    vault: &Vault,
    path: &Path,
    expected: &Digests,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let (mut file, mut decryptor, _) = open_encrypted(vault, path).await?;
    let mut out = Vec::new();
    let mut buffer = vec![0u8; BLOCK];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        decryptor.update(&buffer[..read], &mut out)?;
        if out.len() > limit {
            return Err("Inhalt ist zu groß.".into());
        }
    }
    let digests = decryptor.finish(&mut out)?;
    if digests.plain_sha256 != expected.plain_sha256
        || digests.cipher_sha256 != expected.cipher_sha256
    {
        return Err(
            "Integritätsprüfung fehlgeschlagen: Inhalt weicht vom signierten Manifest ab.".into(),
        );
    }
    Ok(out)
}

pub async fn verify_vault(
    job: &Job,
    vault: &Vault,
    path: &Path,
    expected: &Digests,
) -> Result<(), String> {
    let (mut file, mut decryptor, size) = open_encrypted(vault, path).await?;
    let mut sink = Vec::with_capacity(BLOCK * 2);
    let mut buffer = vec![0u8; BLOCK];
    let mut done = crypto::HEADER_LEN as u64;
    cancellable(
        async {
            loop {
                let read = file
                    .read(&mut buffer)
                    .await
                    .map_err(|error| error.to_string())?;
                if read == 0 {
                    break;
                }
                sink.clear();
                decryptor.update(&buffer[..read], &mut sink)?;
                done += read as u64;
                job.progress(done, size);
            }
            Ok(())
        },
        || {},
    )
    .await?;
    sink.clear();
    let digests = decryptor.finish(&mut sink)?;
    if digests.plain_sha256 != expected.plain_sha256
        || digests.cipher_sha256 != expected.cipher_sha256
    {
        return Err(
            "Integritätsprüfung fehlgeschlagen: Inhalt weicht vom signierten Manifest ab.".into(),
        );
    }
    Ok(())
}
