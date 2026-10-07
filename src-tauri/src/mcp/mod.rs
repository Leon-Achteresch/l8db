pub mod benchmark;
pub mod clients;
pub mod config;
pub mod dashboard;
mod dashboard_builder;
pub mod health;
pub mod nosql;
pub mod open;
pub mod redact;
mod script;
pub mod server;
pub mod workflow;

pub fn serve() {
    server::serve();
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
