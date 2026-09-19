pub mod clients;
pub mod config;
pub mod nosql;
pub mod redact;
pub mod server;

pub fn serve() {
    server::serve();
}
