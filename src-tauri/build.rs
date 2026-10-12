fn main() {
    if tauri_build::is_dev() {
        let mut config: serde_json::Value = std::env::var("TAURI_CONFIG")
            .ok()
            .and_then(|config| serde_json::from_str(&config).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        config["bundle"]["icon"] = serde_json::json!([
            "icons/dev/32x32.png",
            "icons/dev/128x128.png",
            "icons/dev/128x128@2x.png",
            "icons/dev/icon.icns",
            "icons/dev/icon.ico"
        ]);
        let config = config.to_string();
        std::env::set_var("TAURI_CONFIG", &config);
        println!("cargo:rustc-env=TAURI_CONFIG={config}");
        println!("cargo:rerun-if-changed=icons/dev");
    }
    tauri_build::build()
}
