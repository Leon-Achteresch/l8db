use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use url::Url;
use zeroize::Zeroizing;

const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Github,
    Gitlab,
    Azure,
    Gitea,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub kind: Option<Kind>,
    pub host: String,
    pub path: String,
    pub web: String,
    #[serde(skip)]
    scheme: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
    pub state: String,
    pub url: String,
    pub updated_at: String,
    pub head_sha: Option<String>,
    pub merge_sha: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub pull: Pull,
    pub body: String,
    pub approvals: Vec<String>,
    pub stale_approvals: Vec<String>,
    pub changes_requested: Vec<String>,
    pub mergeable: Option<bool>,
    pub merge_state: Option<String>,
    pub checks: String,
    pub own: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub number: u64,
    pub url: String,
    pub author: String,
    pub approvals: Vec<String>,
    pub changes_requested: Vec<String>,
    pub base: String,
}

#[derive(Serialize, Deserialize)]
struct Credential {
    kind: Kind,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub action: String,
    pub repo: String,
    pub kind: Option<Kind>,
    pub token: Option<String>,
    pub number: Option<u64>,
    pub state: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub head: Option<String>,
    pub base: Option<String>,
    pub draft: Option<bool>,
    pub event: Option<String>,
    pub method: Option<String>,
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

fn optional(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn clip(value: &str, limit: usize) -> String {
    let mut clipped: String = value.chars().take(limit).collect();
    if clipped.len() < value.len() {
        clipped.push('…');
    }
    clipped
}

fn loopback(host: &str) -> bool {
    let name = host
        .rsplit_once(':')
        .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()))
        .map_or(host, |(name, _)| name);
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

pub fn parse_remote(raw: &str) -> Result<Remote, String> {
    let raw = raw.trim();
    let unsupported =
        || "Der Remote „origin“ verweist auf keine unterstützte Git-Plattform.".to_string();
    let (scheme, host, path) = if let Some((scheme, rest)) = raw.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let (authority, path) = rest.split_once('/').ok_or_else(unsupported)?;
        let authority = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        let host = match scheme.as_str() {
            "https" | "http" => authority.to_ascii_lowercase(),
            "ssh" | "git" => authority
                .rsplit_once(':')
                .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()))
                .map_or(authority, |(host, _)| host)
                .to_ascii_lowercase(),
            _ => return Err(unsupported()),
        };
        let scheme = if scheme == "http" { "http" } else { "https" };
        (scheme.to_string(), host, path.to_string())
    } else {
        let (authority, path) = raw.split_once(':').ok_or_else(unsupported)?;
        if authority.contains('/') || authority.is_empty() {
            return Err(unsupported());
        }
        let host = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        (
            "https".to_string(),
            host.to_ascii_lowercase(),
            path.to_string(),
        )
    };
    if scheme == "http" && !loopback(&host) {
        return Err("Die Git-Plattform muss per HTTPS erreichbar sein.".into());
    }
    if host.is_empty()
        || host.contains(['/', '\\', '?', '#', ' ', '\0'])
        || path.contains(['?', '#', '\\', '\0'])
    {
        return Err(unsupported());
    }
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let decoded = path
        .split('/')
        .map(|segment| {
            percent_encoding::percent_decode_str(segment)
                .decode_utf8()
                .map(|value| value.into_owned())
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| unsupported())?;
    let segments: Vec<&str> = decoded.iter().map(String::as_str).collect();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.contains(['/', '\\', '\0', '?', '#'])
    }) {
        return Err(unsupported());
    }
    let (host, segments) = if (host == "ssh.dev.azure.com" || host == "vs-ssh.visualstudio.com")
        && segments.first() == Some(&"v3")
        && segments.len() == 4
    {
        (
            "dev.azure.com".to_string(),
            vec![segments[1], segments[2], "_git", segments[3]],
        )
    } else {
        (host, segments)
    };
    let web = |segments: &[&str]| -> Result<String, String> {
        let mut url = Url::parse(&format!("{scheme}://{host}")).map_err(|_| unsupported())?;
        url.path_segments_mut()
            .map_err(|_| unsupported())?
            .clear()
            .extend(segments);
        Ok(url.to_string())
    };
    if let Some(index) = segments.iter().position(|segment| *segment == "_git") {
        let mut repo: Vec<&str> = segments[index + 1..].to_vec();
        if repo
            .first()
            .is_some_and(|value| *value == "_optimized" || *value == "_full")
        {
            repo.remove(0);
        }
        if index == 0 || repo.len() != 1 {
            return Err(unsupported());
        }
        let prefix = &segments[..index];
        if host == "dev.azure.com" && prefix.len() < 2 {
            return Err(unsupported());
        }
        let web = web(&[prefix, &["_git", repo[0]]].concat())?;
        return Ok(Remote {
            kind: Some(Kind::Azure),
            path: [prefix, &[repo[0]]].concat().join("/"),
            host,
            web,
            scheme,
        });
    }
    if segments.len() < 2 {
        return Err(unsupported());
    }
    let kind = match host.as_str() {
        "github.com" => Some(Kind::Github),
        "gitlab.com" => Some(Kind::Gitlab),
        "codeberg.org" => Some(Kind::Gitea),
        "dev.azure.com" => return Err(unsupported()),
        _ if host.ends_with(".visualstudio.com") => return Err(unsupported()),
        _ => None,
    };
    Ok(Remote {
        kind,
        web: web(&segments)?,
        path: segments.join("/"),
        host,
        scheme,
    })
}

impl Remote {
    fn origin(&self) -> String {
        format!("{}://{}", self.scheme, self.host)
    }

    fn url(&self, segments: &[&str]) -> Result<Url, String> {
        let mut url =
            Url::parse(&self.origin()).map_err(|_| "Ungültige Adresse der Git-Plattform")?;
        url.path_segments_mut()
            .map_err(|_| "Ungültige Adresse der Git-Plattform")?
            .clear()
            .extend(segments);
        Ok(url)
    }

    fn split(&self) -> (Vec<&str>, &str, &str) {
        let parts: Vec<&str> = self.path.split('/').collect();
        let count = parts.len();
        (
            parts[..count - 2].to_vec(),
            parts[count - 2],
            parts[count - 1],
        )
    }

    fn repository(&self, kind: Kind, rest: &[&str]) -> Result<Url, String> {
        match kind {
            Kind::Github => {
                let (prefix, owner, repo) = self.split();
                let mut segments: Vec<&str> = if self.host == "github.com" {
                    Vec::new()
                } else {
                    [prefix.as_slice(), &["api", "v3"]].concat()
                };
                segments.extend(["repos", owner, repo]);
                segments.extend(rest);
                if self.host == "github.com" {
                    let mut url = Url::parse("https://api.github.com")
                        .map_err(|_| "Ungültige Adresse der Git-Plattform")?;
                    url.path_segments_mut()
                        .map_err(|_| "Ungültige Adresse der Git-Plattform")?
                        .clear()
                        .extend(&segments);
                    return Ok(url);
                }
                self.url(&segments)
            }
            Kind::Gitea => {
                let (prefix, owner, repo) = self.split();
                let mut segments =
                    [prefix.as_slice(), &["api", "v1", "repos", owner, repo]].concat();
                segments.extend(rest);
                self.url(&segments)
            }
            Kind::Gitlab => {
                let mut segments = vec!["api", "v4", "projects", self.path.as_str()];
                segments.extend(rest);
                self.url(&segments)
            }
            Kind::Azure => {
                let parts: Vec<&str> = self.path.split('/').collect();
                let count = parts.len();
                let mut segments = parts[..count - 1].to_vec();
                segments.extend(["_apis", "git", "repositories", parts[count - 1]]);
                segments.extend(rest);
                let mut url = self.url(&segments)?;
                url.query_pairs_mut().append_pair("api-version", "6.0");
                Ok(url)
            }
        }
    }

    fn account_url(&self, kind: Kind) -> Result<Url, String> {
        match kind {
            Kind::Github if self.host == "github.com" => {
                Url::parse("https://api.github.com/user").map_err(|e| e.to_string())
            }
            Kind::Github => {
                let (prefix, _, _) = self.split();
                self.url(&[prefix.as_slice(), &["api", "v3", "user"]].concat())
            }
            Kind::Gitea => {
                let (prefix, _, _) = self.split();
                self.url(&[prefix.as_slice(), &["api", "v1", "user"]].concat())
            }
            Kind::Gitlab => self.url(&["api", "v4", "user"]),
            Kind::Azure => {
                let parts: Vec<&str> = self.path.split('/').collect();
                let mut segments = parts[..parts.len() - 2].to_vec();
                segments.extend(["_apis", "connectionData"]);
                let mut url = self.url(&segments)?;
                url.query_pairs_mut()
                    .append_pair("api-version", "6.0-preview");
                Ok(url)
            }
        }
    }

    fn token_url(&self, kind: Kind) -> String {
        match kind {
            Kind::Github => format!(
                "{}/settings/tokens/new?scopes=repo&description=l8db",
                self.origin()
            ),
            Kind::Gitlab => format!(
                "{}/-/user_settings/personal_access_tokens?name=l8db&scopes=api",
                self.origin()
            ),
            Kind::Gitea => format!("{}/user/settings/applications", self.origin()),
            Kind::Azure => {
                let parts: Vec<&str> = self.path.split('/').collect();
                format!(
                    "{}/{}/_usersSettings/tokens",
                    self.origin(),
                    parts[..parts.len() - 2].join("/")
                )
            }
        }
    }
}

fn account_key(host: &str) -> String {
    format!("versioning-forge:{host}")
}

async fn credential(host: &str) -> Result<Option<Credential>, String> {
    let Some(raw) = crate::db::secrets::load_secret(account_key(host)).await? else {
        return Ok(None);
    };
    let raw = Zeroizing::new(raw);
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| "Gespeicherter Zugang zur Git-Plattform ist beschädigt. Neu verbinden.".into())
}

struct Client {
    remote: Remote,
    kind: Kind,
    token: Zeroizing<String>,
    http: reqwest::Client,
}

fn api_error(status: StatusCode, body: &[u8]) -> String {
    let detail = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            let message = if value["message"].is_null() {
                &value["error"]
            } else {
                &value["message"]
            };
            match message {
                Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
                Value::Null => None,
                other => Some(other.to_string()),
            }
        });
    let base = match status.as_u16() {
        401 => "Der Token ist ungültig oder abgelaufen.",
        403 => "Der Token hat keine Berechtigung für diese Aktion.",
        404 => {
            "Repository oder Pull Request nicht gefunden. Remote-Adresse und Token-Rechte prüfen."
        }
        405 | 409 | 422 => "Die Git-Plattform hat die Aktion abgelehnt.",
        429 => "Die Git-Plattform begrenzt gerade die Anfragen. Später erneut versuchen.",
        _ => "Die Git-Plattform hat mit einem Fehler geantwortet.",
    };
    match detail {
        Some(detail) => format!("{base} ({})", clip(detail.trim(), 300)),
        None => format!("{base} (HTTP {})", status.as_u16()),
    }
}

impl Client {
    fn new(remote: Remote, kind: Kind, token: Zeroizing<String>) -> Result<Self, String> {
        if remote.kind.is_some_and(|detected| detected != kind) {
            return Err("Die Plattform passt nicht zur Remote-Adresse.".into());
        }
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .user_agent("l8db")
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            remote,
            kind,
            token,
            http,
        })
    }

    async fn connected(remote: Remote) -> Result<Self, String> {
        let stored = credential(&remote.host).await?.ok_or(
            "Keine Verbindung zur Git-Plattform. Unter Reviews einen Zugangstoken hinterlegen.",
        )?;
        Self::new(remote, stored.kind, Zeroizing::new(stored.token))
    }

    async fn send(&self, method: Method, url: Url, body: Option<Value>) -> Result<Value, String> {
        let token = self.token.as_str();
        let mut request = self.http.request(method, url);
        request = match self.kind {
            Kind::Github => request
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28"),
            Kind::Gitlab => request.header("PRIVATE-TOKEN", token),
            Kind::Gitea => request.header("Authorization", format!("token {token}")),
            Kind::Azure => request
                .basic_auth("", Some(token))
                .header("Accept", "application/json"),
        };
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                "Die Git-Plattform antwortet nicht (Zeitlimit).".to_string()
            } else {
                "Die Git-Plattform ist nicht erreichbar. Netzwerk und Adresse prüfen.".to_string()
            }
        })?;
        let status = response.status();
        if status.is_redirection() || status == StatusCode::NON_AUTHORITATIVE_INFORMATION {
            return Err(
                "Die Git-Plattform verlangt eine Anmeldung. Token und Remote-Adresse prüfen."
                    .into(),
            );
        }
        if response
            .content_length()
            .is_some_and(|length| length as usize > LIMIT)
        {
            return Err("Antwort der Git-Plattform ist zu groß.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Antwort der Git-Plattform wurde unterbrochen.")?
        {
            if bytes.len() + chunk.len() > LIMIT {
                return Err("Antwort der Git-Plattform ist zu groß.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            return Err(api_error(status, &bytes));
        }
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "Die Git-Plattform hat keine gültige JSON-Antwort geliefert.".into())
    }

    async fn get(&self, url: Url) -> Result<Value, String> {
        self.send(Method::GET, url, None).await
    }

    fn repo(&self, rest: &[&str]) -> Result<Url, String> {
        self.remote.repository(self.kind, rest)
    }

    async fn account(&self) -> Result<(String, String), String> {
        let value = self.get(self.remote.account_url(self.kind)?).await?;
        let (id, name) = match self.kind {
            Kind::Github | Kind::Gitea => (text(&value["login"]), text(&value["login"])),
            Kind::Gitlab => (text(&value["username"]), text(&value["username"])),
            Kind::Azure => (
                text(&value["authenticatedUser"]["id"]),
                text(&value["authenticatedUser"]["providerDisplayName"]),
            ),
        };
        if id.is_empty() {
            return Err("Der Token wurde von der Git-Plattform nicht akzeptiert.".into());
        }
        Ok((id, name))
    }

    async fn default_branch(&self) -> Result<String, String> {
        let value = self.get(self.repo(&[])?).await?;
        let branch = match self.kind {
            Kind::Azure => text(&value["defaultBranch"])
                .trim_start_matches("refs/heads/")
                .to_string(),
            _ => text(&value["default_branch"]),
        };
        if branch.is_empty() {
            Err("Die Git-Plattform liefert keinen Standardbranch.".into())
        } else {
            Ok(branch)
        }
    }

    fn pull(&self, value: &Value) -> Pull {
        match self.kind {
            Kind::Github => github_pull(value),
            Kind::Gitlab => gitlab_pull(value),
            Kind::Gitea => gitea_pull(value),
            Kind::Azure => azure_pull(value, &self.remote.web),
        }
    }

    async fn pulls(&self, merged: bool) -> Result<Vec<Pull>, String> {
        let mut url = match self.kind {
            Kind::Github | Kind::Gitea => self.repo(&["pulls"])?,
            Kind::Gitlab => self.repo(&["merge_requests"])?,
            Kind::Azure => self.repo(&["pullrequests"])?,
        };
        {
            let mut query = url.query_pairs_mut();
            match self.kind {
                Kind::Github => {
                    query
                        .append_pair("state", if merged { "closed" } else { "open" })
                        .append_pair("sort", "updated")
                        .append_pair("direction", "desc")
                        .append_pair("per_page", "50");
                }
                Kind::Gitea => {
                    query
                        .append_pair("state", if merged { "closed" } else { "open" })
                        .append_pair("sort", "recentupdate")
                        .append_pair("limit", "50");
                }
                Kind::Gitlab => {
                    query
                        .append_pair("state", if merged { "merged" } else { "opened" })
                        .append_pair("order_by", "updated_at")
                        .append_pair("per_page", "50");
                }
                Kind::Azure => {
                    query
                        .append_pair(
                            "searchCriteria.status",
                            if merged { "completed" } else { "active" },
                        )
                        .append_pair("$top", "50");
                }
            }
        }
        let value = self.get(url).await?;
        let items = if self.kind == Kind::Azure {
            value["value"].as_array().cloned().unwrap_or_default()
        } else {
            value.as_array().cloned().unwrap_or_default()
        };
        Ok(items
            .iter()
            .map(|item| self.pull(item))
            .filter(|pull| (pull.state == "merged") == merged)
            .collect())
    }

    async fn raw_pull(&self, number: u64) -> Result<Value, String> {
        let number = number.to_string();
        let url = match self.kind {
            Kind::Github | Kind::Gitea => self.repo(&["pulls", &number])?,
            Kind::Gitlab => self.repo(&["merge_requests", &number])?,
            Kind::Azure => self.repo(&["pullrequests", &number])?,
        };
        self.get(url).await
    }

    async fn reviews(&self, number: u64, raw: &Value, pull: &Pull) -> Result<Reviews, String> {
        let number = number.to_string();
        match self.kind {
            Kind::Github => {
                let mut url = self.repo(&["pulls", &number, "reviews"])?;
                url.query_pairs_mut().append_pair("per_page", "100");
                let reviews = self.get(url).await?;
                Ok(latest_reviews(
                    reviews.as_array().map(Vec::as_slice).unwrap_or_default(),
                    &pull.author,
                    pull.head_sha.as_deref(),
                    false,
                ))
            }
            Kind::Gitea => {
                let reviews = self.get(self.repo(&["pulls", &number, "reviews"])?).await?;
                Ok(latest_reviews(
                    reviews.as_array().map(Vec::as_slice).unwrap_or_default(),
                    &pull.author,
                    pull.head_sha.as_deref(),
                    true,
                ))
            }
            Kind::Gitlab => {
                let approvals = self
                    .get(self.repo(&["merge_requests", &number, "approvals"])?)
                    .await?;
                let mut reviews = Reviews::default();
                for entry in approvals["approved_by"].as_array().into_iter().flatten() {
                    let user = text(&entry["user"]["username"]);
                    if !user.is_empty() && user != pull.author {
                        reviews.approvals.push(user);
                    }
                }
                if let Ok(reviewers) = self
                    .get(self.repo(&["merge_requests", &number, "reviewers"])?)
                    .await
                {
                    for entry in reviewers.as_array().into_iter().flatten() {
                        if entry["state"] == "requested_changes" {
                            reviews
                                .changes_requested
                                .push(text(&entry["user"]["username"]));
                        }
                    }
                }
                Ok(reviews)
            }
            Kind::Azure => Ok(azure_reviews(raw)),
        }
    }

    async fn checks(&self, raw: &Value, pull: &Pull) -> Result<String, String> {
        let Some(sha) = pull.head_sha.as_deref() else {
            return Ok("none".into());
        };
        match self.kind {
            Kind::Github => {
                let mut runs_url = self.repo(&["commits", sha, "check-runs"])?;
                runs_url.query_pairs_mut().append_pair("per_page", "100");
                let runs = self.get(runs_url).await.unwrap_or(Value::Null);
                let status = self
                    .get(self.repo(&["commits", sha, "status"])?)
                    .await
                    .unwrap_or(Value::Null);
                Ok(github_checks(&runs, &status))
            }
            Kind::Gitea => {
                let status = self
                    .get(self.repo(&["commits", sha, "status"])?)
                    .await
                    .unwrap_or(Value::Null);
                Ok(combined_status(&status))
            }
            Kind::Gitlab => Ok(match raw["head_pipeline"]["status"].as_str() {
                Some("success") => "success",
                Some("failed") | Some("canceled") => "failure",
                Some(
                    "running"
                    | "pending"
                    | "created"
                    | "waiting_for_resource"
                    | "preparing"
                    | "scheduled"
                    | "manual",
                ) => "pending",
                _ => "none",
            }
            .into()),
            Kind::Azure => Ok("none".into()),
        }
    }

    async fn detail(&self, number: u64) -> Result<Detail, String> {
        let raw = self.raw_pull(number).await?;
        let pull = self.pull(&raw);
        let reviews = self.reviews(number, &raw, &pull).await?;
        let checks = self.checks(&raw, &pull).await?;
        let (mergeable, merge_state) = match self.kind {
            Kind::Github => (
                raw["mergeable"].as_bool(),
                optional(&raw["mergeable_state"]),
            ),
            Kind::Gitea => (raw["mergeable"].as_bool(), None),
            Kind::Gitlab => {
                let state = optional(&raw["detailed_merge_status"])
                    .or_else(|| optional(&raw["merge_status"]));
                (
                    state
                        .as_deref()
                        .map(|state| state == "mergeable" || state == "can_be_merged"),
                    state,
                )
            }
            Kind::Azure => {
                let state = optional(&raw["mergeStatus"]);
                (
                    match state.as_deref() {
                        Some("succeeded") => Some(true),
                        Some("conflicts" | "failure" | "rejectedByPolicy") => Some(false),
                        _ => None,
                    },
                    state,
                )
            }
        };
        let body = match self.kind {
            Kind::Gitlab | Kind::Azure => text(&raw["description"]),
            _ => text(&raw["body"]),
        };
        let (id, name) = self.account().await?;
        let own = match self.kind {
            Kind::Azure => raw["createdBy"]["id"].as_str() == Some(id.as_str()),
            _ => pull.author == name,
        };
        Ok(Detail {
            pull,
            body,
            approvals: reviews.approvals,
            stale_approvals: reviews.stale,
            changes_requested: reviews.changes_requested,
            mergeable,
            merge_state,
            checks,
            own,
        })
    }

    async fn create(
        &self,
        head: &str,
        base: &str,
        title: &str,
        body: &str,
        draft: bool,
    ) -> Result<Pull, String> {
        let (url, payload) = match self.kind {
            Kind::Github => (
                self.repo(&["pulls"])?,
                json!({"title": title, "head": head, "base": base, "body": body, "draft": draft}),
            ),
            Kind::Gitea => (
                self.repo(&["pulls"])?,
                json!({"title": if draft { format!("WIP: {title}") } else { title.to_string() }, "head": head, "base": base, "body": body}),
            ),
            Kind::Gitlab => (
                self.repo(&["merge_requests"])?,
                json!({"title": if draft { format!("Draft: {title}") } else { title.to_string() }, "source_branch": head, "target_branch": base, "description": body, "remove_source_branch": false}),
            ),
            Kind::Azure => (
                self.repo(&["pullrequests"])?,
                json!({"title": title, "sourceRefName": format!("refs/heads/{head}"), "targetRefName": format!("refs/heads/{base}"), "description": body, "isDraft": draft}),
            ),
        };
        let value = self.send(Method::POST, url, Some(payload)).await?;
        Ok(self.pull(&value))
    }

    async fn review(&self, number: u64, event: &str, body: &str) -> Result<(), String> {
        let id = number.to_string();
        match self.kind {
            Kind::Github | Kind::Gitea => {
                let event = match (self.kind, event) {
                    (Kind::Github, "approve") => "APPROVE",
                    (Kind::Gitea, "approve") => "APPROVED",
                    (_, "request_changes") => "REQUEST_CHANGES",
                    _ => "COMMENT",
                };
                self.send(
                    Method::POST,
                    self.repo(&["pulls", &id, "reviews"])?,
                    Some(json!({"event": event, "body": body})),
                )
                .await?;
            }
            Kind::Gitlab => {
                if event == "approve" {
                    self.send(
                        Method::POST,
                        self.repo(&["merge_requests", &id, "approve"])?,
                        Some(json!({})),
                    )
                    .await?;
                } else if event == "request_changes" {
                    let _ = self
                        .send(
                            Method::POST,
                            self.repo(&["merge_requests", &id, "unapprove"])?,
                            Some(json!({})),
                        )
                        .await;
                }
                if !body.trim().is_empty() {
                    let note = if event == "request_changes" {
                        format!("**Änderungen angefordert**\n\n{body}")
                    } else {
                        body.to_string()
                    };
                    self.send(
                        Method::POST,
                        self.repo(&["merge_requests", &id, "notes"])?,
                        Some(json!({"body": note})),
                    )
                    .await?;
                }
            }
            Kind::Azure => {
                if event == "approve" || event == "request_changes" {
                    let (user, _) = self.account().await?;
                    self.send(
                        Method::PUT,
                        self.repo(&["pullrequests", &id, "reviewers", &user])?,
                        Some(json!({"vote": if event == "approve" { 10 } else { -5 }})),
                    )
                    .await?;
                }
                if !body.trim().is_empty() {
                    self.send(
                        Method::POST,
                        self.repo(&["pullrequests", &id, "threads"])?,
                        Some(json!({"comments": [{"parentCommentId": 0, "content": body, "commentType": 1}], "status": 1})),
                    )
                    .await?;
                }
            }
        }
        Ok(())
    }

    async fn merge(&self, number: u64, squash: bool) -> Result<Value, String> {
        let id = number.to_string();
        match self.kind {
            Kind::Github => {
                let value = self
                    .send(
                        Method::PUT,
                        self.repo(&["pulls", &id, "merge"])?,
                        Some(json!({"merge_method": if squash { "squash" } else { "merge" }})),
                    )
                    .await?;
                Ok(
                    json!({"merged": value["merged"].as_bool().unwrap_or(false), "sha": value["sha"]}),
                )
            }
            Kind::Gitea => {
                self.send(
                    Method::POST,
                    self.repo(&["pulls", &id, "merge"])?,
                    Some(json!({"Do": if squash { "squash" } else { "merge" }, "delete_branch_after_merge": false})),
                )
                .await?;
                let pull = self.pull(&self.raw_pull(number).await?);
                Ok(json!({"merged": pull.state == "merged", "sha": pull.merge_sha}))
            }
            Kind::Gitlab => {
                let value = self
                    .send(
                        Method::PUT,
                        self.repo(&["merge_requests", &id, "merge"])?,
                        Some(json!({"squash": squash, "should_remove_source_branch": false})),
                    )
                    .await?;
                let pull = gitlab_pull(&value);
                Ok(json!({"merged": pull.state == "merged", "sha": pull.merge_sha}))
            }
            Kind::Azure => {
                let raw = self.raw_pull(number).await?;
                let head = raw["lastMergeSourceCommit"]["commitId"].clone();
                if !head.is_string() {
                    return Err("Der Pull Request hat noch keinen prüfbaren Stand.".into());
                }
                let value = self
                    .send(
                        Method::PATCH,
                        self.repo(&["pullrequests", &id])?,
                        Some(json!({"status": "completed", "lastMergeSourceCommit": {"commitId": head}, "completionOptions": {"mergeStrategy": if squash { "squash" } else { "noFastForward" }, "deleteSourceBranch": false, "transitionWorkItems": false}})),
                    )
                    .await?;
                let pull = azure_pull(&value, &self.remote.web);
                Ok(json!({"merged": pull.state == "merged", "sha": pull.merge_sha}))
            }
        }
    }

    async fn evidence(&self, commit: &str, branch: &str) -> Result<Option<Evidence>, String> {
        let candidates: Vec<Value> = match self.kind {
            Kind::Github => self
                .get(self.repo(&["commits", commit, "pulls"])?)
                .await?
                .as_array()
                .cloned()
                .unwrap_or_default(),
            Kind::Gitlab => self
                .get(self.repo(&["repository", "commits", commit, "merge_requests"])?)
                .await?
                .as_array()
                .cloned()
                .unwrap_or_default(),
            Kind::Gitea => match self.get(self.repo(&["commits", commit, "pull"])?).await {
                Ok(value) if value.is_object() => vec![value],
                Ok(_) => Vec::new(),
                Err(error) if error.starts_with("Repository oder Pull Request nicht gefunden") => {
                    Vec::new()
                }
                Err(error) => return Err(error),
            },
            Kind::Azure => {
                let value = self
                    .send(
                        Method::POST,
                        self.repo(&["pullrequestquery"])?,
                        Some(json!({"queries": [{"type": "lastMergeCommit", "items": [commit]}, {"type": "commit", "items": [commit]}]})),
                    )
                    .await?;
                value["results"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|result| result[commit].as_array())
                    .flatten()
                    .cloned()
                    .collect()
            }
        };
        let pulls: Vec<(Pull, Value)> = candidates
            .iter()
            .map(|value| (self.pull(value), value.clone()))
            .filter(|(pull, _)| pull.state == "merged" && pull.base == branch)
            .collect();
        let Some((pull, _)) = pulls
            .iter()
            .find(|(pull, _)| pull.merge_sha.as_deref() == Some(commit))
            .or_else(|| pulls.first())
            .cloned()
        else {
            return Ok(None);
        };
        let raw = self.raw_pull(pull.number).await?;
        let pull = Pull {
            head_sha: self.pull(&raw).head_sha.or(pull.head_sha),
            ..pull
        };
        let reviews = self.reviews(pull.number, &raw, &pull).await?;
        Ok(Some(Evidence {
            number: pull.number,
            url: pull.url,
            author: pull.author,
            approvals: reviews.approvals,
            changes_requested: reviews.changes_requested,
            base: pull.base,
        }))
    }
}

#[derive(Default)]
struct Reviews {
    approvals: Vec<String>,
    stale: Vec<String>,
    changes_requested: Vec<String>,
}

fn latest_reviews(reviews: &[Value], author: &str, head: Option<&str>, gitea: bool) -> Reviews {
    let mut states: BTreeMap<String, (String, Option<String>, bool)> = BTreeMap::new();
    for review in reviews {
        let user = text(&review["user"]["login"]);
        let state = text(&review["state"]);
        if user.is_empty() || (gitea && review["dismissed"].as_bool() == Some(true)) {
            continue;
        }
        let decisive = matches!(
            state.as_str(),
            "APPROVED" | "CHANGES_REQUESTED" | "REQUEST_CHANGES" | "DISMISSED"
        );
        if decisive {
            states.insert(
                user,
                (
                    state,
                    optional(&review["commit_id"]),
                    gitea && review["stale"].as_bool() == Some(true),
                ),
            );
        }
    }
    let mut result = Reviews::default();
    for (user, (state, commit, stale)) in states {
        match state.as_str() {
            "APPROVED" if user != author => {
                let current = !stale
                    && match (head, commit.as_deref()) {
                        (Some(head), Some(commit)) => head == commit,
                        _ => true,
                    };
                if current {
                    result.approvals.push(user);
                } else {
                    result.stale.push(user);
                }
            }
            "CHANGES_REQUESTED" | "REQUEST_CHANGES" => result.changes_requested.push(user),
            _ => {}
        }
    }
    result
}

fn azure_reviews(raw: &Value) -> Reviews {
    let author = raw["createdBy"]["id"].as_str().unwrap_or_default();
    let mut result = Reviews::default();
    for reviewer in raw["reviewers"].as_array().into_iter().flatten() {
        if reviewer["id"].as_str() == Some(author) || reviewer["isContainer"] == true {
            continue;
        }
        let name =
            optional(&reviewer["displayName"]).unwrap_or_else(|| text(&reviewer["uniqueName"]));
        match reviewer["vote"].as_i64() {
            Some(10 | 5) => result.approvals.push(name),
            Some(-5 | -10) => result.changes_requested.push(name),
            _ => {}
        }
    }
    result
}

fn combined_status(status: &Value) -> String {
    if status["total_count"].as_u64().unwrap_or(0) == 0 {
        return "none".into();
    }
    match status["state"].as_str() {
        Some("success") => "success",
        Some("pending") => "pending",
        Some("failure" | "error") => "failure",
        _ => "none",
    }
    .into()
}

fn github_checks(runs: &Value, status: &Value) -> String {
    let mut failure = false;
    let mut pending = false;
    let mut any = false;
    for run in runs["check_runs"].as_array().into_iter().flatten() {
        any = true;
        if run["status"] != "completed" {
            pending = true;
        } else if matches!(
            run["conclusion"].as_str(),
            Some("failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure")
        ) {
            failure = true;
        }
    }
    match combined_status(status).as_str() {
        "failure" => failure = true,
        "pending" => pending = true,
        "success" => any = true,
        _ => {}
    }
    if failure {
        "failure"
    } else if pending {
        "pending"
    } else if any {
        "success"
    } else {
        "none"
    }
    .into()
}

fn github_pull(value: &Value) -> Pull {
    let merged = !value["merged_at"].is_null();
    Pull {
        number: value["number"].as_u64().unwrap_or(0),
        title: text(&value["title"]),
        author: text(&value["user"]["login"]),
        head: text(&value["head"]["ref"]),
        base: text(&value["base"]["ref"]),
        draft: value["draft"].as_bool().unwrap_or(false),
        state: if merged {
            "merged"
        } else if value["state"] == "open" {
            "open"
        } else {
            "closed"
        }
        .into(),
        url: text(&value["html_url"]),
        updated_at: text(&value["updated_at"]),
        head_sha: optional(&value["head"]["sha"]),
        merge_sha: if merged {
            optional(&value["merge_commit_sha"])
        } else {
            None
        },
    }
}

fn gitea_pull(value: &Value) -> Pull {
    let merged = value["merged"].as_bool().unwrap_or(false);
    let title = text(&value["title"]);
    Pull {
        number: value["number"].as_u64().unwrap_or(0),
        draft: value["draft"].as_bool().unwrap_or(false)
            || title.starts_with("WIP:")
            || title.starts_with("[WIP]"),
        title,
        author: text(&value["user"]["login"]),
        head: text(&value["head"]["ref"]),
        base: text(&value["base"]["ref"]),
        state: if merged {
            "merged"
        } else if value["state"] == "open" {
            "open"
        } else {
            "closed"
        }
        .into(),
        url: text(&value["html_url"]),
        updated_at: text(&value["updated_at"]),
        head_sha: optional(&value["head"]["sha"]),
        merge_sha: if merged {
            optional(&value["merge_commit_sha"])
        } else {
            None
        },
    }
}

fn gitlab_pull(value: &Value) -> Pull {
    let merged = value["state"] == "merged";
    Pull {
        number: value["iid"].as_u64().unwrap_or(0),
        title: text(&value["title"]),
        author: text(&value["author"]["username"]),
        head: text(&value["source_branch"]),
        base: text(&value["target_branch"]),
        draft: value["draft"].as_bool().unwrap_or(false)
            || value["work_in_progress"].as_bool().unwrap_or(false),
        state: match value["state"].as_str() {
            Some("opened") => "open",
            Some("merged") => "merged",
            _ => "closed",
        }
        .into(),
        url: text(&value["web_url"]),
        updated_at: text(&value["updated_at"]),
        head_sha: optional(&value["sha"]),
        merge_sha: if merged {
            optional(&value["merge_commit_sha"]).or_else(|| optional(&value["squash_commit_sha"]))
        } else {
            None
        },
    }
}

fn azure_pull(value: &Value, web: &str) -> Pull {
    let number = value["pullRequestId"].as_u64().unwrap_or(0);
    let merged = value["status"] == "completed";
    Pull {
        number,
        title: text(&value["title"]),
        author: optional(&value["createdBy"]["displayName"])
            .unwrap_or_else(|| text(&value["createdBy"]["uniqueName"])),
        head: text(&value["sourceRefName"])
            .trim_start_matches("refs/heads/")
            .to_string(),
        base: text(&value["targetRefName"])
            .trim_start_matches("refs/heads/")
            .to_string(),
        draft: value["isDraft"].as_bool().unwrap_or(false),
        state: match value["status"].as_str() {
            Some("active") => "open",
            Some("completed") => "merged",
            _ => "closed",
        }
        .into(),
        url: format!("{web}/pullrequest/{number}"),
        updated_at: optional(&value["closedDate"]).unwrap_or_else(|| text(&value["creationDate"])),
        head_sha: optional(&value["lastMergeSourceCommit"]["commitId"]),
        merge_sha: if merged {
            optional(&value["lastMergeCommit"]["commitId"])
        } else {
            None
        },
    }
}

async fn repository(repo: &str) -> Result<(PathBuf, Remote), String> {
    let directory = std::fs::canonicalize(repo).map_err(|e| e.to_string())?;
    let root = PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let url = super::git(&root, &["remote", "get-url", "origin"])
        .await
        .map_err(|_| "Das Repository hat keinen Remote „origin“.")?;
    Ok((root.clone(), parse_remote(url.trim())?))
}

fn evidence_cache() -> &'static Mutex<HashMap<String, Evidence>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Evidence>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub async fn evidence(root: &Path, commit: &str, branch: &str) -> Result<Option<Evidence>, String> {
    let url = super::git(root, &["remote", "get-url", "origin"])
        .await
        .map_err(|_| "Das Repository hat keinen Remote „origin“.")?;
    let remote = parse_remote(url.trim())?;
    let key = format!("{}\0{}\0{commit}\0{branch}", remote.host, remote.path);
    if let Some(found) = evidence_cache().lock().unwrap().get(&key).cloned() {
        return Ok(Some(found));
    }
    let client = Client::connected(remote)
        .await
        .map_err(|error| format!("Review-Nachweis nicht prüfbar: {error}"))?;
    let found = client.evidence(commit, branch).await?;
    if let Some(found) = &found {
        evidence_cache().lock().unwrap().insert(key, found.clone());
    }
    Ok(found)
}

pub async fn handle(request: Request) -> Result<Value, String> {
    let (root, remote) = match repository(&request.repo).await {
        Ok(found) => found,
        Err(problem) if request.action == "info" => {
            return Ok(json!({"remote": null, "problem": problem, "connected": false}));
        }
        Err(problem) => return Err(problem),
    };
    match request.action.as_str() {
        "info" => {
            let stored = credential(&remote.host).await?;
            let kind = stored.as_ref().map(|stored| stored.kind).or(remote.kind);
            let token_url = kind.map(|kind| remote.token_url(kind));
            let Some(stored) = stored else {
                return Ok(
                    json!({"remote": remote, "kind": kind, "connected": false, "tokenUrl": token_url}),
                );
            };
            let client = Client::new(remote.clone(), stored.kind, Zeroizing::new(stored.token))?;
            match client.account().await {
                Ok((_, name)) => {
                    let branch = client.default_branch().await.ok();
                    Ok(
                        json!({"remote": remote, "kind": kind, "connected": true, "account": name, "defaultBranch": branch, "tokenUrl": token_url}),
                    )
                }
                Err(problem) => Ok(
                    json!({"remote": remote, "kind": kind, "connected": false, "problem": problem, "tokenUrl": token_url}),
                ),
            }
        }
        "connect" => {
            let kind = request
                .kind
                .or(remote.kind)
                .ok_or("Bitte die Git-Plattform auswählen.")?;
            let token = Zeroizing::new(
                request
                    .token
                    .map(|token| token.trim().to_string())
                    .filter(|token| {
                        !token.is_empty()
                            && token.len() <= 4096
                            && !token.contains(['\n', '\r', '\0'])
                    })
                    .ok_or("Bitte einen gültigen Zugangstoken eingeben.")?,
            );
            let client = Client::new(remote.clone(), kind, token.clone())?;
            let (_, name) = client.account().await?;
            let stored = Zeroizing::new(
                serde_json::to_string(&Credential {
                    kind,
                    token: token.to_string(),
                })
                .map_err(|e| e.to_string())?,
            );
            crate::db::secrets::store_secret(account_key(&remote.host), stored.to_string()).await?;
            Ok(json!({"account": name}))
        }
        "disconnect" => {
            crate::db::secrets::delete_secret(account_key(&remote.host)).await?;
            Ok(Value::Null)
        }
        "pulls" => {
            let client = Client::connected(remote).await?;
            Ok(json!(
                client
                    .pulls(request.state.as_deref() == Some("merged"))
                    .await?
            ))
        }
        "pull" => {
            let client = Client::connected(remote).await?;
            Ok(json!(
                client
                    .detail(request.number.ok_or("Pull Request fehlt")?)
                    .await?
            ))
        }
        "create" => {
            let head = request.head.ok_or("Quell-Branch fehlt")?;
            let base = request.base.ok_or("Ziel-Branch fehlt")?;
            for name in [&head, &base] {
                super::git(&root, &["check-ref-format", &format!("refs/heads/{name}")])
                    .await
                    .map_err(|_| "Ungültiger Branchname")?;
            }
            if head == base {
                return Err("Quell- und Ziel-Branch müssen sich unterscheiden.".into());
            }
            let title = request.title.unwrap_or_default();
            let body = request.body.unwrap_or_default();
            if title.trim().is_empty() || title.len() > 250 || body.len() > 60_000 {
                return Err("Titel (bis 250 Zeichen) und Beschreibung prüfen.".into());
            }
            let client = Client::connected(remote).await?;
            Ok(json!(
                client
                    .create(
                        &head,
                        &base,
                        title.trim(),
                        &body,
                        request.draft.unwrap_or(false)
                    )
                    .await?
            ))
        }
        "review" => {
            let event = request.event.as_deref().unwrap_or("comment");
            if !matches!(event, "approve" | "request_changes" | "comment") {
                return Err("Unbekannte Review-Aktion".into());
            }
            let body = request.body.unwrap_or_default();
            if body.len() > 60_000 || (event != "approve" && body.trim().is_empty()) {
                return Err("Bitte einen Kommentar eingeben.".into());
            }
            let client = Client::connected(remote).await?;
            client
                .review(request.number.ok_or("Pull Request fehlt")?, event, &body)
                .await?;
            Ok(Value::Null)
        }
        "merge" => {
            let client = Client::connected(remote).await?;
            client
                .merge(
                    request.number.ok_or("Pull Request fehlt")?,
                    request.method.as_deref() == Some("squash"),
                )
                .await
        }
        _ => Err("Unbekannte Aktion für die Git-Plattform".into()),
    }
}

#[tauri::command]
pub async fn versioning_forge(request: Request) -> Result<Value, String> {
    handle(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Read, Write};
    use std::sync::Arc;

    struct Seen {
        method: String,
        target: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    type Route = dyn Fn(&str, &str, &str) -> (u16, String) + Send + Sync;

    fn serve(route: Box<Route>) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.is_empty() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or_default().to_string();
                let target = parts.next().unwrap_or_default().to_string();
                let mut headers = Vec::new();
                let mut length = 0;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    let header = header.trim_end();
                    if header.is_empty() {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse().unwrap_or(0);
                        }
                        headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body = String::from_utf8_lossy(&body).to_string();
                let (status, response) = route(&method, &target, &body);
                log.lock().unwrap().push(Seen {
                    method,
                    target,
                    headers,
                    body,
                });
                let reply = format!(
                    "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        (base, seen)
    }

    fn header<'a>(seen: &'a Seen, name: &str) -> &'a str {
        seen.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
            .unwrap_or_default()
    }

    fn client(base: &str, path: &str, kind: Kind) -> Client {
        Client::new(
            parse_remote(&format!("{base}/{path}")).unwrap(),
            kind,
            Zeroizing::new("secret-token".into()),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn github_evidence_counts_current_approvals_of_the_merged_pull_request() {
        let pull = json!({"number": 7, "title": "Release r1", "user": {"login": "alice"}, "head": {"ref": "feature", "sha": "head"}, "base": {"ref": "main"}, "state": "closed", "merged_at": "2026-10-01T10:00:00Z", "merge_commit_sha": "merge", "html_url": "https://ghe.example/acme/shop/pull/7"});
        let other = json!({"number": 8, "user": {"login": "eve"}, "head": {"ref": "x", "sha": "y"}, "base": {"ref": "release"}, "state": "closed", "merged_at": "2026-10-01T10:00:00Z", "merge_commit_sha": "merge"});
        let reviews = json!([
            {"user": {"login": "bob"}, "state": "APPROVED", "commit_id": "head"},
            {"user": {"login": "carol"}, "state": "APPROVED", "commit_id": "old"},
            {"user": {"login": "alice"}, "state": "APPROVED", "commit_id": "head"}
        ]);
        let (base, seen) = serve(Box::new(move |method, target, _| match (method, target) {
            ("GET", "/api/v3/repos/acme/shop/commits/merge/pulls") => {
                (200, json!([other, pull]).to_string())
            }
            ("GET", "/api/v3/repos/acme/shop/pulls/7") => (200, pull.to_string()),
            ("GET", "/api/v3/repos/acme/shop/pulls/7/reviews?per_page=100") => {
                (200, reviews.to_string())
            }
            _ => (404, json!({"message": "Not Found"}).to_string()),
        }));
        let found = client(&base, "acme/shop.git", Kind::Github)
            .evidence("merge", "main")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((found.number, found.author.as_str()), (7, "alice"));
        assert_eq!(found.approvals, vec!["bob"]);
        assert!(found.changes_requested.is_empty());
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen.iter()
                .map(|request| request.target.as_str())
                .collect::<Vec<_>>(),
            [
                "/api/v3/repos/acme/shop/commits/merge/pulls",
                "/api/v3/repos/acme/shop/pulls/7",
                "/api/v3/repos/acme/shop/pulls/7/reviews?per_page=100",
            ]
        );
        for request in seen.iter() {
            assert_eq!(header(request, "authorization"), "Bearer secret-token");
            assert_eq!(header(request, "x-github-api-version"), "2022-11-28");
        }
    }

    #[tokio::test]
    async fn gitlab_and_gitea_requests_use_their_own_auth_and_paths() {
        let (base, seen) = serve(Box::new(|method, target, _| {
            match (method, target) {
            ("GET", "/api/v4/projects/acme%2Fdb%2Fshop/repository/commits/sha/merge_requests") => (
                200,
                json!([{"iid": 5, "title": "x", "author": {"username": "alice"}, "source_branch": "f", "target_branch": "main", "state": "merged", "sha": "head", "merge_commit_sha": "sha", "web_url": "https://gitlab.example/x"}]).to_string(),
            ),
            ("GET", "/api/v4/projects/acme%2Fdb%2Fshop/merge_requests/5") => (
                200,
                json!({"iid": 5, "author": {"username": "alice"}, "source_branch": "f", "target_branch": "main", "state": "merged", "sha": "head", "merge_commit_sha": "sha"}).to_string(),
            ),
            ("GET", "/api/v4/projects/acme%2Fdb%2Fshop/merge_requests/5/approvals") => (
                200,
                json!({"approved_by": [{"user": {"username": "bob"}}, {"user": {"username": "alice"}}]}).to_string(),
            ),
            ("GET", "/api/v4/projects/acme%2Fdb%2Fshop/merge_requests/5/reviewers") => (
                200,
                json!([{"user": {"username": "dan"}, "state": "requested_changes"}]).to_string(),
            ),
            ("POST", "/api/v1/repos/acme/shop/pulls") => (
                201,
                json!({"number": 3, "title": "WIP: Neu", "user": {"login": "alice"}, "head": {"ref": "feature", "sha": "1"}, "base": {"ref": "main"}, "state": "open", "merged": false}).to_string(),
            ),
            _ => (404, json!({"message": "Not Found"}).to_string()),
        }
        }));
        let found = client(&base, "acme/db/shop.git", Kind::Gitlab)
            .evidence("sha", "main")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.approvals, vec!["bob"]);
        assert_eq!(found.changes_requested, vec!["dan"]);
        let created = client(&base, "acme/shop.git", Kind::Gitea)
            .create("feature", "main", "Neu", "Beschreibung", true)
            .await
            .unwrap();
        assert!(created.draft);
        let seen = seen.lock().unwrap();
        assert!(seen[..4]
            .iter()
            .all(|request| header(request, "private-token") == "secret-token"));
        let create = seen.last().unwrap();
        assert_eq!(header(create, "authorization"), "token secret-token");
        let body: Value = serde_json::from_str(&create.body).unwrap();
        assert_eq!(body["title"], "WIP: Neu");
        assert_eq!(
            (body["head"].as_str(), body["base"].as_str()),
            (Some("feature"), Some("main"))
        );
    }

    #[tokio::test]
    async fn azure_evidence_reads_votes_and_queries_both_commit_kinds() {
        let pull = json!({"pullRequestId": 12, "title": "Release", "createdBy": {"id": "me", "displayName": "Alice"}, "sourceRefName": "refs/heads/feature", "targetRefName": "refs/heads/main", "status": "completed", "lastMergeCommit": {"commitId": "merge"}, "lastMergeSourceCommit": {"commitId": "head"}, "reviewers": [
            {"id": "me", "displayName": "Alice", "vote": 10},
            {"id": "b", "displayName": "Ben", "vote": 10},
            {"id": "c", "displayName": "Cleo", "vote": 0}
        ]});
        let listed = pull.clone();
        let (base, seen) = serve(Box::new(move |method, target, _| match (method, target) {
            (
                "POST",
                "/acme/Shop%20DB/_apis/git/repositories/schema/pullrequestquery?api-version=6.0",
            ) => (
                200,
                json!({"results": [{"merge": [listed]}, {}]}).to_string(),
            ),
            (
                "GET",
                "/acme/Shop%20DB/_apis/git/repositories/schema/pullrequests/12?api-version=6.0",
            ) => (200, pull.to_string()),
            _ => (404, json!({"message": "Not Found"}).to_string()),
        }));
        let found = client(&base, "acme/Shop%20DB/_git/schema", Kind::Azure)
            .evidence("merge", "main")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.number, 12);
        assert_eq!(found.approvals, vec!["Ben"]);
        let seen = seen.lock().unwrap();
        let query: Value = serde_json::from_str(&seen[0].body).unwrap();
        assert_eq!(query["queries"][0]["type"], "lastMergeCommit");
        assert_eq!(query["queries"][1]["type"], "commit");
        assert_eq!(
            header(&seen[0], "authorization"),
            "Basic OnNlY3JldC10b2tlbg=="
        );
        assert!(seen
            .iter()
            .all(|request| request.method == "POST" || request.method == "GET"));
    }

    #[tokio::test]
    async fn failures_never_leak_the_token_and_redirects_are_refused() {
        let (base, _) = serve(Box::new(|_, target, _| {
            if target.contains("moved") {
                (302, String::new())
            } else {
                (401, json!({"message": "Bad credentials"}).to_string())
            }
        }));
        let error = client(&base, "acme/shop.git", Kind::Github)
            .get(Url::parse(&format!("{base}/moved")).unwrap())
            .await
            .unwrap_err();
        assert!(error.contains("verlangt eine Anmeldung"));
        let error = client(&base, "acme/shop.git", Kind::Github)
            .account()
            .await
            .unwrap_err();
        assert_eq!(
            error,
            "Der Token ist ungültig oder abgelaufen. (Bad credentials)"
        );
        assert!(!error.contains("secret-token"));
        assert!(Client::new(
            parse_remote("https://github.com/acme/shop").unwrap(),
            Kind::Gitlab,
            Zeroizing::new("x".into())
        )
        .is_err());
    }

    #[test]
    fn remotes_map_to_platforms_and_api_urls() {
        let github = parse_remote("git@github.com:acme/shop-db.git").unwrap();
        assert_eq!(github.kind, Some(Kind::Github));
        assert_eq!(github.path, "acme/shop-db");
        assert_eq!(
            github
                .repository(Kind::Github, &["pulls"])
                .unwrap()
                .as_str(),
            "https://api.github.com/repos/acme/shop-db/pulls"
        );
        let enterprise = parse_remote("https://token:secret@ghe.acme.de/acme/shop-db").unwrap();
        assert_eq!(enterprise.kind, None);
        assert_eq!(enterprise.host, "ghe.acme.de");
        assert_eq!(
            enterprise
                .repository(Kind::Github, &["pulls", "7"])
                .unwrap()
                .as_str(),
            "https://ghe.acme.de/api/v3/repos/acme/shop-db/pulls/7"
        );
        let gitlab = parse_remote("ssh://git@gitlab.com:2222/acme/db/shop.git").unwrap();
        assert_eq!(gitlab.kind, Some(Kind::Gitlab));
        assert_eq!(
            gitlab
                .repository(Kind::Gitlab, &["merge_requests"])
                .unwrap()
                .as_str(),
            "https://gitlab.com/api/v4/projects/acme%2Fdb%2Fshop/merge_requests"
        );
        let azure = parse_remote("https://acme@dev.azure.com/acme/Shop%20DB/_git/schema").unwrap();
        assert_eq!(azure.kind, Some(Kind::Azure));
        assert_eq!(
            azure.web,
            "https://dev.azure.com/acme/Shop%20DB/_git/schema"
        );
        assert_eq!(
            azure.repository(Kind::Azure, &["pullrequests"]).unwrap().as_str(),
            "https://dev.azure.com/acme/Shop%20DB/_apis/git/repositories/schema/pullrequests?api-version=6.0"
        );
        assert_eq!(
            azure.account_url(Kind::Azure).unwrap().as_str(),
            "https://dev.azure.com/acme/_apis/connectionData?api-version=6.0-preview"
        );
        let azure_ssh = parse_remote("git@ssh.dev.azure.com:v3/acme/Shop/schema").unwrap();
        assert_eq!(azure_ssh.path, "acme/Shop/schema");
        let server =
            parse_remote("https://tfs.acme.de/tfs/DefaultCollection/Shop/_git/schema").unwrap();
        assert_eq!(server.kind, Some(Kind::Azure));
        assert_eq!(
            server.account_url(Kind::Azure).unwrap().as_str(),
            "https://tfs.acme.de/tfs/DefaultCollection/_apis/connectionData?api-version=6.0-preview"
        );
        let gitea = parse_remote("http://127.0.0.1:3000/team/shop.git").unwrap();
        assert_eq!(
            gitea.repository(Kind::Gitea, &["pulls"]).unwrap().as_str(),
            "http://127.0.0.1:3000/api/v1/repos/team/shop/pulls"
        );
        let subpath = parse_remote("https://git.acme.de/gitea/team/shop.git").unwrap();
        assert_eq!(
            subpath.repository(Kind::Gitea, &[]).unwrap().as_str(),
            "https://git.acme.de/gitea/api/v1/repos/team/shop"
        );
        for invalid in [
            "/srv/git/shop.git",
            "file:///srv/git/shop.git",
            "http://git.acme.de/team/shop.git",
            "https://github.com/acme",
            "https://dev.azure.com/acme/_git/schema",
            "https://github.com/acme/../shop",
        ] {
            assert!(parse_remote(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn reviews_count_only_current_approvals_from_other_people() {
        let reviews = json!([
            {"user": {"login": "alice"}, "state": "APPROVED", "commit_id": "old"},
            {"user": {"login": "bob"}, "state": "APPROVED", "commit_id": "head"},
            {"user": {"login": "carol"}, "state": "CHANGES_REQUESTED", "commit_id": "head"},
            {"user": {"login": "carol"}, "state": "COMMENTED", "commit_id": "head"},
            {"user": {"login": "dave"}, "state": "APPROVED", "commit_id": "head"},
            {"user": {"login": "dave"}, "state": "DISMISSED", "commit_id": "head"},
            {"user": {"login": "author"}, "state": "APPROVED", "commit_id": "head"}
        ]);
        let result = latest_reviews(reviews.as_array().unwrap(), "author", Some("head"), false);
        assert_eq!(result.approvals, vec!["bob"]);
        assert_eq!(result.stale, vec!["alice"]);
        assert_eq!(result.changes_requested, vec!["carol"]);
        let gitea = json!([
            {"user": {"login": "erin"}, "state": "APPROVED", "stale": true, "commit_id": "head"},
            {"user": {"login": "frank"}, "state": "APPROVED", "dismissed": true},
            {"user": {"login": "gina"}, "state": "APPROVED", "commit_id": "head"}
        ]);
        let result = latest_reviews(gitea.as_array().unwrap(), "author", Some("head"), true);
        assert_eq!(result.approvals, vec!["gina"]);
        assert_eq!(result.stale, vec!["erin"]);
        let azure = json!({"createdBy": {"id": "me"}, "reviewers": [
            {"id": "me", "displayName": "Me", "vote": 10},
            {"id": "a", "displayName": "Anna", "vote": 5},
            {"id": "b", "displayName": "Ben", "vote": -10},
            {"id": "team", "displayName": "Team", "vote": 10, "isContainer": true}
        ]});
        let result = azure_reviews(&azure);
        assert_eq!(result.approvals, vec!["Anna"]);
        assert_eq!(result.changes_requested, vec!["Ben"]);
    }

    #[test]
    fn platform_payloads_normalize_to_pull_requests() {
        let github = github_pull(
            &json!({"number": 4, "title": "Release 1.2", "user": {"login": "alice"}, "head": {"ref": "feature/x", "sha": "abc"}, "base": {"ref": "main"}, "draft": false, "state": "closed", "merged_at": "2026-10-01T10:00:00Z", "merge_commit_sha": "def", "html_url": "https://github.com/a/b/pull/4", "updated_at": "2026-10-01T10:00:00Z"}),
        );
        assert_eq!(
            (github.state.as_str(), github.merge_sha.as_deref()),
            ("merged", Some("def"))
        );
        let gitlab = gitlab_pull(
            &json!({"iid": 9, "title": "Draft: x", "author": {"username": "bob"}, "source_branch": "f", "target_branch": "main", "draft": true, "state": "opened", "sha": "abc", "web_url": "https://gitlab.com/a/b/-/merge_requests/9"}),
        );
        assert_eq!(
            (gitlab.number, gitlab.state.as_str(), gitlab.draft),
            (9, "open", true)
        );
        let azure = azure_pull(
            &json!({"pullRequestId": 12, "title": "x", "createdBy": {"displayName": "Carla"}, "sourceRefName": "refs/heads/feature/y", "targetRefName": "refs/heads/main", "status": "completed", "lastMergeCommit": {"commitId": "fff"}, "lastMergeSourceCommit": {"commitId": "eee"}}),
            "https://dev.azure.com/a/p/_git/r",
        );
        assert_eq!(azure.head, "feature/y");
        assert_eq!(azure.url, "https://dev.azure.com/a/p/_git/r/pullrequest/12");
        assert_eq!(azure.merge_sha.as_deref(), Some("fff"));
        let gitea = gitea_pull(
            &json!({"number": 3, "title": "WIP: y", "user": {"login": "dan"}, "head": {"ref": "f", "sha": "1"}, "base": {"ref": "main"}, "state": "open", "merged": false}),
        );
        assert!(gitea.draft);
        assert_eq!(gitea.state, "open");
        assert_eq!(
            github_checks(
                &json!({"check_runs": [{"status": "completed", "conclusion": "success"}, {"status": "in_progress"}]}),
                &json!({"total_count": 0})
            ),
            "pending"
        );
        assert_eq!(
            github_checks(
                &json!({"check_runs": []}),
                &json!({"total_count": 1, "state": "failure"})
            ),
            "failure"
        );
        assert_eq!(
            github_checks(&json!({}), &json!({"total_count": 0})),
            "none"
        );
    }

    #[test]
    fn api_errors_never_echo_raw_bodies_beyond_the_message() {
        let error = api_error(
            StatusCode::UNAUTHORIZED,
            br#"{"message":"Bad credentials","documentation_url":"x"}"#,
        );
        assert_eq!(
            error,
            "Der Token ist ungültig oder abgelaufen. (Bad credentials)"
        );
        let error = api_error(StatusCode::BAD_GATEWAY, b"<html>proxy</html>");
        assert!(error.ends_with("(HTTP 502)"));
    }
}
