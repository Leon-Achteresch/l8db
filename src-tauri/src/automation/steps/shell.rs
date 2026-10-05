use std::process::Stdio;

use tokio::io::{AsyncRead, AsyncReadExt};

use crate::automation::model::{Action, LogLevel};
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::automation::steps::{resolve_path, wrong_action};

const MAX_OUTPUT: usize = 1024 * 1024;

async fn drain(mut reader: impl AsyncRead + Unpin) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = MAX_OUTPUT.saturating_sub(kept.len());
                if n > room {
                    truncated = true;
                }
                kept.extend_from_slice(&buffer[..n.min(room)]);
            }
        }
    }
    (kept, truncated)
}

async fn finish(
    mut task: tokio::task::JoinHandle<(Vec<u8>, bool)>,
    grace: std::time::Duration,
) -> (Vec<u8>, bool) {
    match tokio::time::timeout(grace, &mut task).await {
        Ok(result) => result.unwrap_or_default(),
        Err(_) => {
            task.abort();
            (Vec::new(), false)
        }
    }
}

fn kill_tree(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    let _ = child.start_kill();
}

pub async fn shell(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Shell {
        program,
        args,
        cwd,
        env,
        success_codes,
        capture,
    } = config
    else {
        return Err(wrong_action());
    };
    let program = ctx.vars.render(program)?;
    if program.trim().is_empty() {
        return Err("Programm fehlt.".into());
    }
    let mut command = crate::process::command(program.trim());
    for arg in args {
        command.arg(ctx.vars.render(arg)?);
    }
    if let Some(dir) = cwd.as_deref().filter(|d| !d.trim().is_empty()) {
        command.current_dir(resolve_path(ctx, dir).await?);
    }
    for (name, value) in env {
        command.env(name, ctx.vars.render(value)?);
    }
    command
        .env("L8DB_RUN_ID", ctx.run_id)
        .env("L8DB_TASK", &ctx.task.name)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Programm „{}“ konnte nicht gestartet werden: {error}",
            program.trim()
        )
    })?;
    let stdout = tokio::spawn(drain(child.stdout.take().expect("stdout")));
    let stderr = tokio::spawn(drain(child.stderr.take().expect("stderr")));
    let status = tokio::select! {
        status = child.wait() => status.map_err(|error| format!("Programm konnte nicht überwacht werden: {error}"))?,
        _ = ctx.cancel.cancelled() => {
            kill_tree(&mut child);
            let _ = child.wait().await;
            stdout.abort();
            stderr.abort();
            return Err("Abgebrochen.".into());
        }
    };
    let grace = std::time::Duration::from_secs(2);
    let (out, out_cut) = finish(stdout, grace).await;
    let (err, err_cut) = finish(stderr, grace).await;
    let out = String::from_utf8_lossy(&out).into_owned();
    let err = String::from_utf8_lossy(&err).into_owned();
    if !out.trim().is_empty() {
        let suffix = if out_cut {
            "\n… (auf 1 MiB gekürzt)"
        } else {
            ""
        };
        (ctx.log)(LogLevel::Info, format!("{}{suffix}", out.trim_end()));
    }
    if !err.trim().is_empty() {
        let suffix = if err_cut {
            "\n… (auf 1 MiB gekürzt)"
        } else {
            ""
        };
        (ctx.log)(LogLevel::Warn, format!("{}{suffix}", err.trim_end()));
    }
    let Some(code) = status.code() else {
        return Err("Programm wurde durch ein Signal beendet.".into());
    };
    if !success_codes.contains(&code) {
        return Err(format!("Programm endete mit Code {code}."));
    }
    let mut outcome = StepOutcome {
        value: Some(serde_json::json!(code)),
        ..StepOutcome::default()
    };
    if let Some(name) = capture.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        outcome
            .vars
            .insert(name.to_string(), out.trim().to_string());
    }
    Ok(outcome)
}

#[cfg(all(test, unix))]
mod tests {
    use crate::automation::engine::tests::{harness, step};
    use crate::automation::model::RunStatus;
    use serde_json::json;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn exit_codes_capture_and_env() {
        let h = harness().await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("a", json!({ "type": "shell", "program": "sh", "args": ["-c", "exit 3"], "successCodes": [0, 3] })),
                    step("b", json!({ "type": "shell", "program": "sh", "args": ["-c", "printf '%s|%s|%s' \"$1\" \"$L8DB_TASK\" \"$GREETING\"", "x", "${task}; rm -rf /"], "env": { "GREETING": "hi ${step.a.value}" }, "capture": "out" })),
                    step("c", json!({ "type": "condition", "left": "${out}", "op": "eq", "right": "Test Task; rm -rf /|Test Task|hi 3", "then": { "type": "next" }, "otherwise": { "type": "end_failure" } })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let run = h
            .db
            .run(&h.services, vec![step("a", json!({ "type": "shell", "program": "sh", "args": ["-c", "echo boom >&2; exit 3"] }))])
            .await;
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(run.error.as_deref(), Some("Programm endete mit Code 3."));
        let detail = h.services.store.get_run(&run.id).await.unwrap().unwrap();
        assert!(detail.logs.iter().any(|line| line.message.contains("boom")));
    }

    #[tokio::test]
    async fn program_is_not_run_through_a_shell() {
        let h = harness().await;
        let run =
            h.db.run(
                &h.services,
                vec![step(
                    "a",
                    json!({ "type": "shell", "program": "echo hi; exit 0" }),
                )],
            )
            .await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.error.unwrap().contains("konnte nicht gestartet werden"));
    }

    #[tokio::test]
    async fn cancel_kills_process() {
        let h = harness().await;
        let marker = h.dir.path().join("pid");
        let task = h
            .db
            .save(
                &h.services,
                vec![step("a", json!({ "type": "shell", "program": "sh", "args": ["-c", format!("echo $$ > '{}'; exec sleep 30", marker.display())] }))],
            )
            .await;
        let started = Instant::now();
        let run_id = crate::automation::engine::start(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        while !marker.exists() || std::fs::read_to_string(&marker).unwrap().trim().is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let pid: i32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(crate::automation::engine::cancel(&run_id));
        let run = h.db.wait_finished(&h.services, &run_id).await;
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "Prozess läuft noch");
    }
}
