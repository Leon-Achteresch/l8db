use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use tokio_util::sync::CancellationToken;

const RELEASES_URL: &str =
    "https://api.github.com/repos/Leon-Achteresch/l8db/releases?per_page=100";
const RELEASE_PAGE_SIZE: usize = 100;
static RELEASE_REQUESTS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReleasePage {
    versions: Vec<String>,
    next_page: Option<u32>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

fn release_version(tag: &str) -> Option<semver::Version> {
    let version = semver::Version::parse(tag.strip_prefix('v')?).ok()?;
    let canary = version
        .pre
        .strip_prefix("canary.")
        .is_some_and(|counter| counter.parse::<u64>().is_ok());
    (version.build.is_empty() && (version.pre.is_empty() || canary)).then_some(version)
}

fn newest_manifest(releases: Vec<Release>) -> Option<String> {
    releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = release_version(&release.tag_name)?;
            let manifest = release
                .assets
                .into_iter()
                .find(|asset| asset.name == "latest.json")?;
            Some((version, manifest.browser_download_url))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, url)| url)
}

fn allowed_version(tag: &str, channel: &str) -> Option<semver::Version> {
    release_version(tag).filter(|version| channel == "canary" || version.pre.is_empty())
}

fn is_selected_update(
    current: &semver::Version,
    release: &semver::Version,
    expected: &semver::Version,
) -> bool {
    release == expected && current != expected
}

fn selected_endpoint(version: &str, channel: &str) -> Result<url::Url, String> {
    let tag = format!("v{version}");
    allowed_version(&tag, channel).ok_or("Version ist für diesen Updatekanal nicht verfügbar")?;
    url::Url::parse(&format!(
        "https://github.com/Leon-Achteresch/l8db/releases/download/{tag}/latest.json"
    ))
    .map_err(|error| error.to_string())
}

fn release_page(releases: Vec<Release>, channel: &str, page: u32) -> UpdateReleasePage {
    let next_page = (releases.len() == RELEASE_PAGE_SIZE).then_some(page + 1);
    let mut versions: Vec<_> = releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter(|release| {
            release
                .assets
                .iter()
                .any(|asset| asset.name == "latest.json")
        })
        .filter_map(|release| allowed_version(&release.tag_name, channel))
        .collect();
    versions.sort_unstable_by(|left, right| right.cmp(left));
    versions.dedup();
    UpdateReleasePage {
        versions: versions
            .into_iter()
            .map(|version| version.to_string())
            .collect(),
        next_page,
    }
}

fn effective_channel(channel: &str) -> Result<String, String> {
    let policy = crate::organization::current(false)?;
    let channel = policy
        .policy
        .settings
        .update_channel
        .as_deref()
        .unwrap_or(channel);
    if !["stable", "canary"].contains(&channel) {
        return Err("Ungültiger Updatekanal".into());
    }
    Ok(channel.to_owned())
}

async fn fetch_releases(timeout: Duration, page: u32) -> Result<Vec<Release>, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("l8db")
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{RELEASES_URL}&page={page}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?
        .json::<Vec<Release>>()
        .await
        .map_err(|error| error.to_string())
}

async fn canary_endpoint(timeout: Duration) -> Result<url::Url, String> {
    let manifest = newest_manifest(fetch_releases(timeout, 1).await?)
        .ok_or("Keine Version mit Update-Manifest gefunden")?;
    url::Url::parse(&manifest).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_update_releases(
    channel: String,
    page: u32,
    request_id: String,
) -> Result<UpdateReleasePage, String> {
    let channel = effective_channel(&channel)?;
    if page == 0 || page == u32::MAX {
        return Err("Ungültige Versionsseite".into());
    }
    let token = CancellationToken::new();
    RELEASE_REQUESTS
        .lock()
        .map_err(|error| error.to_string())?
        .insert(request_id.clone(), token.clone());
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err("Versionsabfrage abgebrochen".to_owned()),
        result = fetch_releases(Duration::from_secs(20), page) => result,
    };
    RELEASE_REQUESTS
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&request_id);
    Ok(release_page(result?, &channel, page))
}

#[tauri::command]
pub fn cancel_update_release_request(request_id: String) {
    if let Ok(requests) = RELEASE_REQUESTS.lock() {
        if let Some(token) = requests.get(&request_id) {
            token.cancel();
        }
    }
}

#[cfg(windows)]
fn stop_background_instances() {
    let _ = crate::process::std_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'l8db.exe' -and $_.ProcessId -ne $PID -and $_.CommandLine -match '--(mcp|automation-tick|run-task|list-tasks|ai-mcp-relay)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }",
        ])
        .status();
}

#[cfg(not(windows))]
fn stop_background_instances() {}

#[tauri::command]
pub async fn check_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
    timeout: u64,
    version: Option<String>,
) -> Result<Option<UpdateMetadata>, String> {
    let channel = effective_channel(&channel)?;
    let timeout = Duration::from_millis(timeout);
    let app = webview.app_handle().clone();
    let mut builder = webview
        .updater_builder()
        .timeout(timeout)
        .on_before_exit(move || {
            app.cleanup_before_exit();
            stop_background_instances();
        });
    if let Some(version) = version.as_deref() {
        let endpoint = selected_endpoint(version, &channel)?;
        let expected = semver::Version::parse(version).map_err(|error| error.to_string())?;
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|error| error.to_string())?
            .version_comparator(move |current, release| {
                is_selected_update(&current, &release.version, &expected)
            });
    } else if channel == "canary" {
        builder = builder
            .endpoints(vec![canary_endpoint(timeout).await?])
            .map_err(|error| error.to_string())?;
    } else {
        builder = builder.version_comparator(|current, release| {
            if current.pre.is_empty() {
                release.version > current
            } else {
                release.version != current
            }
        });
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    if version
        .as_deref()
        .is_some_and(|version| version != update.version)
    {
        return Err("Update-Manifest gehört nicht zur gewählten Version".into());
    }
    Ok(Some(UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.and_then(|date| date.format(&Rfc3339).ok()),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, manifest: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            assets: manifest
                .then(|| Asset {
                    name: "latest.json".into(),
                    browser_download_url: format!("https://example.com/{tag}/latest.json"),
                })
                .into_iter()
                .collect(),
        }
    }

    #[test]
    fn history_filters_channels_and_skips_uninstallable_releases() {
        let fixtures = || {
            let mut draft = release("v2.0.0", true);
            draft.draft = true;
            vec![
                release("v0.17.0-canary.9", true),
                release("v0.17.0-canary.10", true),
                release("v0.17.0", true),
                release("v0.16.0", true),
                release("v0.16.0", true),
                release("v0.15.0", false),
                release("v0.18.0-beta.1", true),
                release("feature-video-x", true),
                draft,
            ]
        };
        assert_eq!(
            release_page(fixtures(), "stable", 1).versions,
            ["0.17.0", "0.16.0"]
        );
        assert_eq!(
            release_page(fixtures(), "canary", 1).versions,
            ["0.17.0", "0.17.0-canary.10", "0.17.0-canary.9", "0.16.0"]
        );
        assert_eq!(release_page(fixtures(), "canary", 1).next_page, None);
    }

    #[test]
    fn history_can_reach_beyond_the_first_hundred_releases() {
        let releases = (1..=100)
            .map(|counter| release(&format!("v0.18.0-canary.{counter}"), true))
            .collect();
        let page = release_page(releases, "stable", 7);
        assert!(page.versions.is_empty());
        assert_eq!(page.next_page, Some(8));
        let last = release_page(vec![release("v0.1.0", true)], "stable", 8);
        assert_eq!(last.versions, ["0.1.0"]);
        assert_eq!(last.next_page, None);
    }

    #[test]
    fn explicit_versions_allow_downgrades_but_only_to_the_selected_release() {
        let parse = |value| semver::Version::parse(value).unwrap();
        for (current, expected) in [
            ("0.18.0", "0.9.1"),
            ("0.18.0-canary.9", "0.17.0"),
            ("0.18.0-canary.9", "0.18.0-canary.2"),
            ("0.17.0", "0.18.0-canary.2"),
        ] {
            assert!(is_selected_update(
                &parse(current),
                &parse(expected),
                &parse(expected)
            ));
            assert!(!is_selected_update(
                &parse(current),
                &parse("99.0.0"),
                &parse(expected)
            ));
            assert!(!is_selected_update(
                &parse(expected),
                &parse(expected),
                &parse(expected)
            ));
        }
        assert_eq!(
            selected_endpoint("0.9.1", "stable").unwrap().as_str(),
            "https://github.com/Leon-Achteresch/l8db/releases/download/v0.9.1/latest.json"
        );
        assert!(selected_endpoint("0.18.0-canary.2", "canary").is_ok());
        assert!(selected_endpoint("0.17.0", "canary").is_ok());
        assert!(selected_endpoint("0.18.0-canary.2", "stable").is_err());
        for invalid in [
            "../latest",
            "0.18.0-beta.1",
            "0.18.0+build.1",
            "0.18.0/other",
            "v0.18.0",
        ] {
            assert!(selected_endpoint(invalid, "canary").is_err());
        }
    }

    #[test]
    fn history_page_performance_stays_bounded_for_ten_thousand_releases() {
        let mut timings = Vec::new();
        for page in 1..=100 {
            let releases = (1..=100)
                .map(|counter| release(&format!("v0.18.0-canary.{}", page * 100 + counter), true))
                .collect();
            let start = std::time::Instant::now();
            let result = release_page(releases, "canary", page);
            timings.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.versions.len(), 100);
            assert!(serde_json::to_vec(&result).unwrap().len() < 4096);
        }
        timings.sort_by(f64::total_cmp);
        eprintln!("update history: 10,000 releases, 100 per page, median {:.3} ms, p95 {:.3} ms, payload <4096 bytes", timings[50], timings[94]);
        assert!(timings[94] < 20.0);
    }

    #[test]
    fn canary_picks_the_highest_release_with_manifest() {
        let pick = |releases| newest_manifest(releases).unwrap();
        assert_eq!(
            pick(vec![
                release("v0.14.0-canary.9", true),
                release("v0.14.0-canary.10", true),
                release("v0.13.1", true),
                release("feature-video-x", true),
            ]),
            "https://example.com/v0.14.0-canary.10/latest.json"
        );
        assert_eq!(
            pick(vec![
                release("v0.14.0-canary.10", true),
                release("v0.14.0", true),
                release("v0.15.0-canary.1", false),
                release("v0.16.0-beta.1", true),
            ]),
            "https://example.com/v0.14.0/latest.json"
        );
        assert!(newest_manifest(vec![release("v0.14.0", false)]).is_none());
    }
}
