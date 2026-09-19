pub mod clients;
pub mod config;
pub mod dashboard;
pub mod nosql;
pub mod redact;
pub mod server;

pub fn serve() {
    server::serve();
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
