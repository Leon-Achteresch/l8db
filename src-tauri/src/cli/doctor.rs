use serde_json::{json, Value};

fn row(check: &str, status: &str, detail: impl Into<String>) -> Value {
    json!({"check":check,"status":status,"detail":detail.into()})
}

pub fn report(test_keychain: bool) -> Vec<Value> {
    let mut rows = vec![
        row("Version", "ok", env!("CARGO_PKG_VERSION")),
        row(
            "Plattform",
            "ok",
            format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH),
        ),
    ];
    match crate::organization::current(true) {
        Ok(policy) => rows.push(row(
            "IT-Richtlinie",
            "ok",
            if policy.managed {
                format!("Verwaltet: {}", policy.path.display())
            } else {
                "Keine Maschinenrichtlinie eingerichtet".into()
            },
        )),
        Err(error) => rows.push(row("IT-Richtlinie", "error", error)),
    }
    match crate::team::team_connections() {
        Ok(file) => rows.push(row(
            "Team-Verbindungen",
            "ok",
            format!(
                "{} Einträge; ohne Ausgabe von Verbindungsdaten",
                file["connections"].as_array().map_or(0, Vec::len)
            ),
        )),
        Err(error) => rows.push(row("Team-Verbindungen", "error", error)),
    }
    let providers = crate::db::provider::list_providers();
    let available = providers
        .iter()
        .filter(|provider| provider.driver_status.available)
        .count();
    rows.push(row("Provider", "ok", format!("{available} von {} Produkten verfügbar; fehlende optionale Treiber in der App einrichten", providers.len())));
    if test_keychain {
        let account = format!("doctor-{}-{}", std::process::id(), rand::random::<u64>());
        let probe = format!("probe-{}", rand::random::<u64>());
        let result = crate::db::secrets::locked(|| {
            crate::db::secrets::write_secret(&account, &probe)?;
            let loaded = crate::db::secrets::read_secret(&account);
            let removed = crate::db::secrets::remove_secret(&account);
            removed?;
            if loaded? != Some(probe) {
                return Err("Schlüsselbund-Rückprüfung fehlgeschlagen".into());
            }
            Ok::<_, String>(())
        });
        rows.push(match result {
            Ok(()) => row("Schlüsselbund", "ok", if cfg!(debug_assertions) { "Development-Secrets geprüft; dies ist kein Produktions-Keychain-Nachweis" } else { "Schreiben, Lesen und Entfernen erfolgreich" }),
            Err(_) => row("Schlüsselbund", "error", "Schreiben, Lesen oder Entfernen fehlgeschlagen. Schlüsselbund entsperren und erneut prüfen."),
        });
    } else {
        rows.push(row(
            "Schlüsselbund",
            "warn",
            "Nicht geprüft; gezielt mit --test-keychain prüfen",
        ));
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doctor_does_not_export_connections_or_credentials() {
        let rows = report(false);
        assert!(rows
            .iter()
            .any(|row| row["check"] == "Schlüsselbund" && row["status"] == "warn"));
        for row in rows {
            assert_eq!(row.as_object().unwrap().len(), 3);
        }
    }
}
