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

const POSIX_SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"];
const OTHER_SHELLS: &[&str] = &["cmd", "powershell", "pwsh", "fish"];

fn base_name(value: &str) -> String {
    let name = value
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    name.strip_suffix(".exe")
        .map(str::to_string)
        .unwrap_or(name)
}

fn placeholders(template: &str) -> impl Iterator<Item = (usize, usize)> + '_ {
    let mut at = 0;
    std::iter::from_fn(move || loop {
        let start = at + template[at..].find('$')?;
        let tail = &template[start..];
        if tail.starts_with("$${") {
            at = start + 3;
        } else if tail.starts_with("${") {
            let end = start + tail.find('}')?;
            at = end + 1;
            return Some((start, end));
        } else {
            at = start + 1;
        }
    })
}

fn posix_unsafe(script: &str) -> Option<String> {
    #[derive(PartialEq)]
    enum Quote {
        None,
        Single,
        Double,
        Ansi,
        Comment,
        Heredoc,
    }
    let spans: Vec<(usize, usize)> = placeholders(script).collect();
    let mut state = Quote::None;
    let mut escaped = false;
    let mut previous = ' ';
    let mut index = 0;
    while index < script.len() {
        if let Some(&(start, end)) = spans.iter().find(|(start, _)| *start == index) {
            let content = &script[start + 2..end];
            let last = content.rsplit('|').next().map(str::trim);
            if state != Quote::None || escaped || !content.contains('|') || last != Some("shell") {
                return Some(content.to_string());
            }
            index = end + 1;
            previous = '}';
            continue;
        }
        let Some(c) = script[index..].chars().next() else {
            break;
        };
        let next = script[index + c.len_utf8()..].chars().next();
        match state {
            Quote::Single => {
                if c == '\'' {
                    state = Quote::None;
                }
            }
            Quote::Double | Quote::Ansi => {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if (state == Quote::Double && c == '"')
                    || (state == Quote::Ansi && c == '\'')
                {
                    state = Quote::None;
                }
            }
            Quote::Comment => {
                if c == '\n' {
                    state = Quote::None;
                }
            }
            Quote::Heredoc => {}
            Quote::None => {
                if escaped {
                    escaped = false;
                } else {
                    match c {
                        '\\' => escaped = true,
                        '\'' => state = Quote::Single,
                        '"' => state = Quote::Double,
                        '$' if next == Some('\'') => {
                            state = Quote::Ansi;
                            index += 1;
                        }
                        '#' if previous.is_whitespace() || ";&|()<>".contains(previous) => {
                            state = Quote::Comment
                        }
                        '<' if next == Some('<') => state = Quote::Heredoc,
                        _ => {}
                    }
                }
            }
        }
        previous = c;
        index += c.len_utf8();
    }
    None
}

pub fn script_issue(rendered: &[String], templates: &[String]) -> Option<String> {
    let shell = rendered.iter().position(|word| {
        let name = base_name(word);
        POSIX_SHELLS.contains(&name.as_str()) || OTHER_SHELLS.contains(&name.as_str())
    })?;
    if OTHER_SHELLS.contains(&base_name(&rendered[shell]).as_str()) {
        let mut safe = false;
        for (word, template) in rendered.iter().zip(templates).skip(shell + 1) {
            if let Some((start, end)) = placeholders(template).next().filter(|_| !safe) {
                return Some(format!(
                    "Platzhalter „{}“ darf in Befehlen für cmd, PowerShell oder fish nicht stehen. Werte als Umgebungsvariablen übergeben.",
                    &template[start..=end]
                ));
            }
            safe |= matches!(word.to_ascii_lowercase().as_str(), "-file" | "-f");
        }
        return None;
    }
    let flag = rendered.iter().skip(shell + 1).position(|word| {
        word.starts_with('-')
            && !word.starts_with("--")
            && word[1..].chars().all(|c| c.is_ascii_alphabetic())
            && word.contains('c')
    })? + shell
        + 1;
    let content = posix_unsafe(templates.get(flag + 1)?)?;
    Some(format!(
        "Platzhalter „${{{content}}}“ steht ungeschützt im Shell-Skript. „${{…|shell}}“ außerhalb von Anführungszeichen nutzen oder den Wert als weiteres Argument übergeben und im Skript \"$1\" verwenden."
    ))
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
    let templates: Vec<String> = std::iter::once(program.clone())
        .chain(args.iter().cloned())
        .collect();
    let program = ctx.vars.render(program)?;
    if program.trim().is_empty() {
        return Err("Programm fehlt.".into());
    }
    let mut words = vec![program.trim().to_string()];
    for arg in args {
        words.push(ctx.vars.render(arg)?);
    }
    if let Some(message) = script_issue(&words, &templates) {
        return Err(message);
    }
    let mut command = crate::process::command(program.trim());
    command.args(&words[1..]);
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

#[cfg(test)]
mod guard_tests {
    use super::script_issue;

    fn check(words: &[&str]) -> Option<String> {
        let words: Vec<String> = words.iter().map(|w| w.to_string()).collect();
        script_issue(&words, &words)
    }

    #[test]
    fn placeholders_in_shell_scripts_need_the_shell_filter() {
        assert!(check(&["sh", "-c", "echo ${x}"]).is_some());
        assert!(check(&["/bin/bash", "-lc", "echo ${x|trim}"]).is_some());
        assert!(check(&["env", "bash", "-c", "rm ${x|shell|upper}"]).is_some());
        assert!(check(&["sh", "-c", "echo \"${x|shell}\""]).is_some());
        assert!(check(&["sh", "-c", "echo '${x|shell}'"]).is_some());
        assert!(check(&["sh", "-c", "echo $'a ${x|shell}'"]).is_some());
        assert!(check(&["sh", "-c", "echo \\${x|shell}"]).is_some());
        assert!(check(&["sh", "-c", "# it's\necho ${x|shell}"]).is_none());
        assert!(check(&["sh", "-c", "# note ${x|shell}"]).is_some());
        assert!(check(&["sh", "-c", "cat <<EOF\n${x|shell}\nEOF"]).is_some());
        assert!(check(&["sh", "-c", "echo ${x|shell} > ${date|filename|shell}"]).is_none());
        assert!(check(&["sh", "-c", "echo \"$1\" $${HOME}", "_", "${x}"]).is_none());
        assert!(check(&["pg_dump", "-c", "${x}"]).is_none());
        assert!(check(&["cmd.exe", "/c", "echo ${x}"]).is_some());
        assert!(check(&["pwsh", "-Command", "Write-Output ${x|shell}"]).is_some());
        assert!(check(&["pwsh", "-File", "run.ps1", "${x}"]).is_none());
    }
}
