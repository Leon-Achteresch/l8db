use std::borrow::Cow;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use tauri::ipc::{Invoke, InvokeBody, RuntimeAuthority};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Context, Pattern, WebviewUrl, WebviewWindowBuilder, Wry};

mod db {
    use serde::Deserialize;

    #[derive(Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "lowercase")]
    pub enum DatabaseKind {
        Postgres,
        Sqlite,
        Influxdb,
    }

    #[derive(Clone)]
    pub struct PoolState;

    pub struct UnsupportedProvider;

    impl UnsupportedProvider {
        pub async fn list_databases(&self) -> Result<Vec<String>, String> {
            Err("Only the scoped InfluxDB catalog is available in the fixture".into())
        }
    }

    pub fn create_adapter_from_string(
        _: DatabaseKind,
        _: &str,
        _: Option<&str>,
        _: PoolState,
    ) -> Result<UnsupportedProvider, String> {
        Err("Only the scoped InfluxDB catalog is available in the fixture".into())
    }

    pub mod execution {
        use serde::{Deserialize, Serialize};
        use std::{future::Future, time::Duration};

        #[derive(Deserialize)]
        pub struct ExecutionOptions {}

        pub fn connection_duration() -> Duration {
            Duration::from_secs(5)
        }

        pub fn query_duration() -> Duration {
            Duration::from_secs(10)
        }

        pub async fn connect<T>(
            future: impl Future<Output = Result<T, String>>,
        ) -> Result<T, String> {
            future.await
        }

        pub async fn run<T: Serialize>(
            _: Option<ExecutionOptions>,
            _: bool,
            future: impl Future<Output = Result<T, String>>,
        ) -> Result<T, String> {
            let result = future.await?;
            println!(
                "list_databases response {}",
                serde_json::to_string(&result).unwrap()
            );
            Ok(result)
        }
    }

    mod http_api {
        include!(concat!(env!("A45_NATIVE_SOURCE"), "/http_api.rs"));
    }

    mod influxdb {
        use super::http_api::{self, text};
        use serde::Serialize;
        use serde_json::Value;
        use std::collections::{BTreeMap, HashMap, HashSet};
        use std::sync::{Mutex, OnceLock};
        include!(concat!(env!("A45_NATIVE_SOURCE"), "/influxdb.rs"));
    }

    pub mod commands {
        use super::{create_adapter_from_string, DatabaseKind, PoolState};
        include!(concat!(env!("A45_NATIVE_SOURCE"), "/commands.rs"));
    }
}

struct FixtureAssets(PathBuf);

impl Assets<Wry> for FixtureAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let path = Path::new(key.as_ref().trim_start_matches('/'));
        if path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return None;
        }
        std::fs::read(self.0.join(path)).ok().map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data = PathBuf::from(std::env::var_os("A45_NATIVE_DATA").ok_or("Missing private fixture")?);
    let connections: serde_json::Value =
        serde_json::from_slice(&std::fs::read(data.join("connections.json"))?)?;
    let mut allowed = BTreeMap::new();
    for (entry, id) in connections
        .as_array()
        .filter(|entries| entries.len() == 3)
        .ok_or("Three private fixture connections required")?
        .iter()
        .zip(["alpha", "beta", "missing-scope"])
    {
        assert_eq!(entry["id"], id);
        assert_eq!(entry["kind"], "influxdb");
        let dsn = entry["connectionString"]
            .as_str()
            .ok_or("Missing private fixture DSN")?;
        let parsed = url::Url::parse(dsn)?;
        assert_eq!(parsed.scheme(), "influxdb");
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        assert!(parsed.port().is_some());
        allowed.insert(dsn.to_string(), id);
    }
    let init = format!("window.__L8DB_A45_NATIVE_CONNECTIONS__={connections};");
    let app_config = serde_json::from_value(serde_json::json!({
        "identifier": "local.l8db.a45-native",
        "productName": "A45 Native InfluxDB",
        "app": {"security": {"csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost"}},
    }))?;
    let context = Context::new(
        app_config,
        Box::new(FixtureAssets(data.join("assets"))),
        None,
        None,
        tauri::PackageInfo {
            name: "A45 Native InfluxDB".into(),
            version: "0.0.1".parse()?,
            authors: "",
            description: "Isolated l8db native acceptance",
            crate_name: "a45_native",
        },
        Pattern::Brownfield,
        RuntimeAuthority::new(BTreeMap::new(), Default::default()),
        None,
    );
    let handler: fn(Invoke<Wry>) -> bool = tauri::generate_handler![db::commands::list_databases];
    tauri::Builder::default()
        .manage(db::PoolState)
        .invoke_handler(move |invoke: Invoke<Wry>| {
            if invoke.message.command() != "list_databases" {
                return false;
            }
            if let InvokeBody::Json(args) = invoke.message.payload() {
                if args["kind"] == "influxdb" && args["withBucketRetention"] == true {
                    if let Some(id) = args["connectionString"]
                        .as_str()
                        .and_then(|dsn| allowed.get(dsn))
                    {
                        println!("list_databases request {id}");
                        return handler(invoke);
                    }
                }
            }
            invoke.resolver.reject("Outside the isolated A45 fixture");
            true
        })
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "a45",
                WebviewUrl::App("tests/fixtures/influx-bucket-retention.html".into()),
            )
            .title("A45 Native InfluxDB")
            .inner_size(560.0, 320.0)
            .incognito(true)
            .data_directory(data.join("webview"))
            .initialization_script(init)
            .build()?;
            Ok(())
        })
        .run(context)?;
    Ok(())
}
