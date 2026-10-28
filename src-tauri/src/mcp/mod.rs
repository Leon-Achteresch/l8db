pub mod benchmark;
mod catalog;
pub mod clients;
mod code;
#[cfg(all(test, feature = "duckdb"))]
mod code_tests;
mod code_worker;
pub mod config;
pub mod dashboard;
mod dashboard_builder;
mod discovery;
mod drilldown;
pub mod health;
pub mod insight;
pub mod nosql;
mod objects;
pub mod open;
mod overview;
mod persist;
pub mod redact;
pub(crate) mod sandbox;
mod script;
pub mod server;
pub mod workflow;

#[cfg(all(test, feature = "duckdb"))]
mod token_benchmark;

pub fn serve() {
    server::serve();
}

pub fn sandbox() -> i32 {
    code_worker::serve()
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
