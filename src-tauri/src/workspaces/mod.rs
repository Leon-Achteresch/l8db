mod adapter;
pub(crate) mod client;
mod crypto;
mod model;
mod server;
#[cfg(test)]
mod tests;

pub use adapter::WorkspaceAdapter;

pub fn cli(args: &[String]) -> i32 {
    let value = |flag: &str| {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|index| args.get(index + 1))
            .cloned()
    };
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("l8db --workspace-server [--listen 127.0.0.1:3891] [--data /absoluter/pfad] [--allow-remote] [--allow-local-files]\nBeim ersten Start L8DB_WORKSPACE_ADMIN_EMAIL und L8DB_WORKSPACE_ADMIN_PASSWORD setzen. Entfernte Clients verwenden HTTPS über einen Reverse-Proxy.");
        return 0;
    }
    let address = value("--listen").unwrap_or_else(|| "127.0.0.1:3891".into());
    let address: std::net::SocketAddr = match address.parse() {
        Ok(address) => address,
        Err(_) => {
            eprintln!("Ungültige Listen-Adresse.");
            return 2;
        }
    };
    if !address.ip().is_loopback() && !args.iter().any(|arg| arg == "--allow-remote") {
        eprintln!("Entfernte Bindung benötigt --allow-remote und einen HTTPS-Reverse-Proxy.");
        return 2;
    }
    if args.iter().any(|arg| arg == "--allow-local-files") && !address.ip().is_loopback() {
        eprintln!("Lokale Dateien dürfen nur über eine Loopback-Bindung freigegeben werden.");
        return 2;
    }
    let root = match value("--data")
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(client::default_root)
    {
        Ok(root) if root.is_absolute() => root,
        _ => {
            eprintln!("Workspace benötigt einen absoluten Datenpfad.");
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            eprintln!("Workspace-Laufzeit konnte nicht gestartet werden.");
            return 1;
        }
    };
    let result:Result<(),String>=runtime.block_on(async{
        let state=server::ServerState::open(&root)?.with_local_files(args.iter().any(|arg|arg=="--allow-local-files"));
        if let (Ok(email),Ok(password))=(std::env::var("L8DB_WORKSPACE_ADMIN_EMAIL"),std::env::var("L8DB_WORKSPACE_ADMIN_PASSWORD")){state.bootstrap(model::Credentials{email,password})?;}
        if state.db.lock().map_err(|_|"Workspace ist blockiert")?.query_row("SELECT count(*) FROM users",[],|row|row.get::<_,i64>(0)).map_err(|_|"Workspace ist beschädigt")?==0{return Err("Beim ersten Start L8DB_WORKSPACE_ADMIN_EMAIL und L8DB_WORKSPACE_ADMIN_PASSWORD setzen.".into());}
        let listener=tokio::net::TcpListener::bind(address).await.map_err(|_|"Workspace-Port kann nicht geöffnet werden")?;
        eprintln!("Workspace läuft auf {}",listener.local_addr().map_err(|_|"Workspace-Port fehlt")?);
        axum::serve(listener,server::router(state)).with_graceful_shutdown(async{let _=tokio::signal::ctrl_c().await;}).await.map_err(|_|"Workspace-Server wurde unerwartet beendet".to_string())
    });
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}
