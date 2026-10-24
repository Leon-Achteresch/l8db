use rquickjs::context::EvalOptions;
use rquickjs::promise::PromiseState;
use rquickjs::{
    CatchResultExt, CaughtError, Context, Ctx, Exception, Function, Persistent, Promise, Runtime,
    Value,
};
use serde::Deserialize;
use serde_json::{json, Value as Json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::rc::Rc;
use std::time::{Duration, Instant};

const PRELUDE: &str = include_str!("code_prelude.js");
const MAX_ARGS: usize = 256 << 10;
const MAX_PENDING: usize = 10_000;
const MAX_LOG_LINES: usize = 100;
const MAX_LOG_CHARS: usize = 8_000;
const LOG_LINE: usize = 1_000;

#[derive(Deserialize)]
pub(super) struct Init {
    pub code: String,
    pub ms: u64,
    pub memory: usize,
    pub stack: usize,
    pub chars: u32,
    pub items: u32,
}

type Resolvers = (Persistent<Function<'static>>, Persistent<Function<'static>>);

struct Bridge {
    out: std::io::StdoutLock<'static>,
    next: u64,
    pending: HashMap<u64, Resolvers>,
    logs: Vec<String>,
    log_chars: usize,
    dropped: usize,
}

impl Bridge {
    fn send(&mut self, message: &Json) {
        let sent = serde_json::to_writer(&mut self.out, message).is_ok()
            && self.out.write_all(b"\n").is_ok()
            && self.out.flush().is_ok();
        if !sent {
            std::process::exit(0);
        }
    }

    fn log(&mut self, line: String) {
        if self.logs.len() >= MAX_LOG_LINES || self.log_chars >= MAX_LOG_CHARS {
            self.dropped += 1;
            return;
        }
        let line: String = line.chars().take(LOG_LINE).collect();
        self.log_chars += line.chars().count();
        self.logs.push(line);
    }
}

pub fn serve() -> i32 {
    #[cfg(unix)]
    close_inherited();
    std::thread::Builder::new()
        .name("code".into())
        .stack_size(16 << 20)
        .spawn(work)
        .ok()
        .and_then(|handle| handle.join().ok())
        .unwrap_or(70)
}

#[cfg(unix)]
fn close_inherited() {
    let dir = if cfg!(target_os = "linux") {
        "/proc/self/fd"
    } else {
        "/dev/fd"
    };
    let fds: Vec<i32> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse().ok())
                .collect()
        })
        .unwrap_or_default();
    for fd in fds.into_iter().filter(|fd| *fd > 2) {
        unsafe {
            libc::close(fd);
        }
    }
}

fn work() -> i32 {
    let bridge = Rc::new(RefCell::new(Bridge {
        out: std::io::stdout().lock(),
        next: 0,
        pending: HashMap::new(),
        logs: Vec::new(),
        log_chars: 0,
        dropped: 0,
    }));
    bridge.borrow_mut().send(&json!({"t": "ready"}));
    let mut input = std::io::stdin().lock();
    let mut line = String::new();
    if input.read_line(&mut line).unwrap_or(0) == 0 {
        return 65;
    }
    let Ok(init) = serde_json::from_str::<Init>(&line) else {
        return 65;
    };
    let mut message = execute(&init, &bridge, &mut input);
    let mut bridge = bridge.borrow_mut();
    message["log"] = json!(std::mem::take(&mut bridge.logs));
    if bridge.dropped > 0 {
        message["dropped"] = json!(bridge.dropped);
    }
    bridge.send(&message);
    0
}

fn failure(text: impl Into<String>) -> Json {
    json!({"t": "error", "e": text.into()})
}

fn options(filename: &str) -> EvalOptions {
    let mut options = EvalOptions::default();
    options.strict = false;
    options.filename = Some(filename.into());
    options
}

fn execute(init: &Init, bridge: &Rc<RefCell<Bridge>>, input: &mut impl BufRead) -> Json {
    let Ok(runtime) = Runtime::new() else {
        return failure("sandbox runtime could not start");
    };
    runtime.set_memory_limit(init.memory);
    runtime.set_max_stack_size(init.stack);
    let deadline = Instant::now() + Duration::from_millis(init.ms);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let Ok(context) = Context::full(&runtime) else {
        return failure("sandbox context could not start");
    };
    let message = match context.with(|ctx| start(&ctx, init, bridge)) {
        Ok((promise, offset)) => drive(
            &runtime, &context, &promise, offset, deadline, bridge, input,
        ),
        Err(error) => error,
    };
    bridge.borrow_mut().pending.clear();
    limit(message, init)
}

fn drive(
    runtime: &Runtime,
    context: &Context,
    promise: &Persistent<Promise<'static>>,
    offset: usize,
    deadline: Instant,
    bridge: &Rc<RefCell<Bridge>>,
    input: &mut impl BufRead,
) -> Json {
    loop {
        loop {
            match runtime.execute_pending_job() {
                Ok(true) => {}
                Ok(false) => break,
                Err(_) => {
                    return context.with(|ctx| describe(ctx.catch(), offset));
                }
            }
        }
        if let Some(message) = context.with(|ctx| settle(&ctx, promise, offset)) {
            return message;
        }
        if Instant::now() >= deadline {
            return failure("InternalError: interrupted");
        }
        if bridge.borrow().pending.is_empty() {
            return failure(
                "code awaits a promise that never settles; only binding calls (sql, query, catalog …) resolve",
            );
        }
        let mut line = String::new();
        if input.read_line(&mut line).unwrap_or(0) == 0 {
            std::process::exit(0);
        }
        let Some((id, payload)) = line
            .trim_end_matches(['\n', '\r'])
            .split_once('\t')
            .and_then(|(id, payload)| Some((id.parse::<u64>().ok()?, payload.to_string())))
        else {
            return failure("sandbox received a malformed reply");
        };
        let Some((resolve, reject)) = bridge.borrow_mut().pending.remove(&id) else {
            continue;
        };
        context.with(|ctx| answer(&ctx, resolve, reject, &payload));
    }
}

fn answer(
    ctx: &Ctx<'_>,
    resolve: Persistent<Function<'static>>,
    reject: Persistent<Function<'static>>,
    payload: &str,
) {
    let (Ok(resolve), Ok(reject)) = (resolve.restore(ctx), reject.restore(ctx)) else {
        return;
    };
    let settled = match payload.strip_prefix('!') {
        Some(error) => {
            let message: String = serde_json::from_str(error).unwrap_or_else(|_| error.to_string());
            reject.call::<_, ()>((message,))
        }
        None => match ctx.json_parse(payload.to_string()) {
            Ok(value) => resolve.call::<_, ()>((value,)),
            Err(_) => {
                let error = ctx.catch();
                reject.call::<_, ()>((error,))
            }
        },
    };
    if settled.is_err() {
        ctx.catch();
    }
}

fn start<'js>(
    ctx: &Ctx<'js>,
    init: &Init,
    bridge: &Rc<RefCell<Bridge>>,
) -> Result<(Persistent<Promise<'static>>, usize), Json> {
    let setup = |error: CaughtError<'js>| describe_caught(error, 0);
    let prelude: Function = ctx
        .eval_with_options(PRELUDE, options("prelude"))
        .catch(ctx)
        .map_err(setup)?;
    let host = host_function(ctx, bridge.clone())
        .catch(ctx)
        .map_err(setup)?;
    let log = log_function(ctx, bridge.clone())
        .catch(ctx)
        .map_err(setup)?;
    let run: Function = prelude
        .call((host, log, init.chars, init.items))
        .catch(ctx)
        .map_err(setup)?;
    let trimmed = init.code.trim_start();
    let (source, offset) = if ["async", "(", "function"]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
    {
        (format!("({}\n)", init.code), 0)
    } else {
        (format!("(async () => {{\n{}\n}})", init.code), 1)
    };
    let user: Value = ctx
        .eval_with_options(source, options("code"))
        .catch(ctx)
        .map_err(|error| describe_caught(error, offset))?;
    let promise: Promise = run
        .call((user,))
        .catch(ctx)
        .map_err(|error| describe_caught(error, offset))?;
    Ok((Persistent::save(ctx, promise), offset))
}

fn host_function<'js>(
    ctx: &Ctx<'js>,
    bridge: Rc<RefCell<Bridge>>,
) -> rquickjs::Result<Function<'js>> {
    Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, op: String, args: String| -> rquickjs::Result<Promise<'js>> {
            if args.len() > MAX_ARGS {
                return Err(Exception::throw_range(
                    &ctx,
                    "binding arguments are too large",
                ));
            }
            let Ok(parsed) = serde_json::from_str::<Json>(&args) else {
                return Err(Exception::throw_type(
                    &ctx,
                    "binding arguments are not JSON",
                ));
            };
            if bridge.borrow().pending.len() >= MAX_PENDING {
                return Err(Exception::throw_range(
                    &ctx,
                    "too many pending binding calls",
                ));
            }
            let (promise, resolve, reject) = ctx.promise()?;
            let mut bridge = bridge.borrow_mut();
            bridge.next += 1;
            let id = bridge.next;
            bridge.pending.insert(
                id,
                (
                    Persistent::save(&ctx, resolve),
                    Persistent::save(&ctx, reject),
                ),
            );
            bridge.send(&json!({"t": "call", "id": id, "op": op, "a": parsed}));
            Ok(promise)
        },
    )
}

fn log_function<'js>(
    ctx: &Ctx<'js>,
    bridge: Rc<RefCell<Bridge>>,
) -> rquickjs::Result<Function<'js>> {
    Function::new(ctx.clone(), move |line: String| {
        bridge.borrow_mut().log(line)
    })
}

fn settle(ctx: &Ctx<'_>, promise: &Persistent<Promise<'static>>, offset: usize) -> Option<Json> {
    let promise = promise.clone().restore(ctx).ok()?;
    match promise.state() {
        PromiseState::Pending => None,
        PromiseState::Resolved => Some(match promise.result::<String>() {
            Some(Ok(text)) => match serde_json::from_str::<Json>(&text) {
                Ok(mut message) => {
                    message["t"] = json!("done");
                    message
                }
                Err(_) => failure("the result could not be serialized"),
            },
            _ => failure("the result could not be serialized"),
        }),
        PromiseState::Rejected => Some(match promise.result::<Value>() {
            Some(result) => match result.catch(ctx) {
                Err(error) => describe_caught(error, offset),
                Ok(value) => describe(value, offset),
            },
            None => failure("rejected"),
        }),
    }
}

fn describe(value: Value<'_>, offset: usize) -> Json {
    match value.as_object().cloned().and_then(Exception::from_object) {
        Some(exception) => describe_caught(CaughtError::Exception(exception), offset),
        None => describe_caught(CaughtError::Value(value), offset),
    }
}

fn describe_caught(error: CaughtError<'_>, offset: usize) -> Json {
    let (text, stack) = match &error {
        CaughtError::Exception(exception) => {
            let name: String = exception.get("name").unwrap_or_else(|_| "Error".into());
            (
                format!("{name}: {}", exception.message().unwrap_or_default()),
                exception.stack().unwrap_or_default(),
            )
        }
        CaughtError::Value(value) => (
            format!(
                "Uncaught {}",
                value
                    .as_string()
                    .and_then(|text| text.to_string().ok())
                    .or_else(|| value.as_number().map(|number| number.to_string()))
                    .unwrap_or_else(|| value.type_name().to_string())
            ),
            String::new(),
        ),
        CaughtError::Error(error) => (error.to_string(), String::new()),
    };
    let mut message = failure(text);
    if let Some(line) = code_line(&stack)
        .and_then(|line| line.checked_sub(offset))
        .filter(|line| *line > 0)
    {
        message["line"] = json!(line);
    }
    message
}

fn code_line(stack: &str) -> Option<usize> {
    stack.match_indices("code:").find_map(|(at, _)| {
        let before = stack[..at].chars().next_back();
        if !matches!(before, Some('(' | ' ')) {
            return None;
        }
        let digits: String = stack[at + 5..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        digits.parse().ok()
    })
}

fn limit(mut message: Json, init: &Init) -> Json {
    let text = message["e"].as_str().unwrap_or("").to_string();
    if text == "InternalError: interrupted" {
        message["e"] = json!(format!(
            "time limit of {:.0} s reached; the code was stopped",
            init.ms as f64 / 1000.0
        ));
    } else if text.ends_with("out of memory") {
        message["e"] = json!(format!(
            "memory limit of {} MB reached; return aggregates instead of building large arrays",
            init.memory >> 20
        ));
    }
    message
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore]
    fn worker_entry() {
        if std::env::var_os("L8DB_CODE_WORKER").is_some() {
            std::process::exit(super::serve());
        }
    }

    #[test]
    fn stack_lines_point_into_the_code() {
        assert_eq!(
            super::code_line("Error: x\n    at <anonymous> (prelude:9:3)\n    at f (code:12:7)\n"),
            Some(12)
        );
        assert_eq!(super::code_line("    at code:3:1\n"), Some(3));
        assert_eq!(super::code_line("    at mycode:3:1\n"), None);
    }
}
