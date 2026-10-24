pub mod benchmark;
mod catalog;
pub mod clients;
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

#[cfg(test)]
mod token_benchmark;

pub fn serve() {
    server::serve();
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
