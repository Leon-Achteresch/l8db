use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;

const RELEASES_URL: &str =
    "https://api.github.com/repos/Leon-Achteresch/l8db/releases?per_page=100";

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

async fn canary_endpoint(timeout: Duration) -> Result<url::Url, String> {
    let releases = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("l8db")
        .build()
        .map_err(|error| error.to_string())?
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?
        .json::<Vec<Release>>()
        .await
        .map_err(|error| error.to_string())?;
    let manifest = newest_manifest(releases).ok_or("Keine Version mit Update-Manifest gefunden")?;
    url::Url::parse(&manifest).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
    timeout: u64,
) -> Result<Option<UpdateMetadata>, String> {
    let timeout = Duration::from_millis(timeout);
    let mut builder = webview.updater_builder().timeout(timeout);
    if channel == "canary" {
        builder = builder
            .endpoints(vec![canary_endpoint(timeout).await?])
            .map_err(|error| error.to_string())?;
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
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
