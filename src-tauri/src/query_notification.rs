fn completion_message(succeeded: bool, duration_ms: u64) -> Option<(&'static str, String)> {
    if duration_ms < 10_000 {
        return None;
    }
    let title = if succeeded {
        "Abfrage abgeschlossen"
    } else {
        "Abfrage fehlgeschlagen"
    };
    Some((
        title,
        format!(
            "Laufzeit: {} Sekunden. Details in l8db.",
            duration_ms / 1_000
        ),
    ))
}

#[tauri::command]
pub async fn notify_query_completion(
    window: tauri::Window,
    succeeded: bool,
    duration_ms: u64,
) -> Result<(), String> {
    if window.is_focused().unwrap_or(true) {
        return Ok(());
    }
    if let Some((title, body)) = completion_message(succeeded, duration_ms) {
        crate::automation::notify::native(title, &body).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_queries_are_silent_and_long_queries_have_generic_messages() {
        assert!(completion_message(true, 9_999).is_none());
        assert_eq!(
            completion_message(true, 10_000),
            Some((
                "Abfrage abgeschlossen",
                "Laufzeit: 10 Sekunden. Details in l8db.".into()
            ))
        );
        assert_eq!(
            completion_message(false, 25_999),
            Some((
                "Abfrage fehlgeschlagen",
                "Laufzeit: 25 Sekunden. Details in l8db.".into()
            ))
        );
    }
}
