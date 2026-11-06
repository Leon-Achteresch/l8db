use std::path::{Path, PathBuf};

use serde::Serialize;

use super::auth::{expand_home, home_dir};

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SshConfigJump {
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub identity_agent: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub identity_agent: Option<String>,
    pub proxy_jump: Vec<SshConfigJump>,
}

#[derive(Debug, Clone, Default)]
struct RawHost {
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    identity_agent: Option<String>,
    proxy_jump: Option<String>,
}

impl RawHost {
    fn set(&mut self, key: &str, value: &str) {
        match key {
            "hostname" => fill(&mut self.host_name, value.to_string()),
            "user" => fill(&mut self.user, value.to_string()),
            "port" if self.port.is_none() => self.port = value.parse().ok(),
            "identityfile" => fill(
                &mut self.identity_file,
                expand_home(value).display().to_string(),
            ),
            "identityagent" => fill(&mut self.identity_agent, value.to_string()),
            "proxyjump" => fill(&mut self.proxy_jump, value.to_string()),
            _ => {}
        }
    }
}

fn fill(slot: &mut Option<String>, value: String) {
    if slot.is_none() {
        *slot = Some(value);
    }
}

fn unquote(value: &str) -> &str {
    let trimmed = value.trim();
    trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed)
}

fn split_line(line: &str) -> Option<(String, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let key = line[..split].to_ascii_lowercase();
    let value = line[split..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    Some((key, value.trim()))
}

fn is_pattern(alias: &str) -> bool {
    alias.contains(['*', '?', '!'])
}

fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    match pattern.split_first() {
        None => text.is_empty(),
        Some((b'*', rest)) => (0..=text.len()).any(|skip| glob_match(rest, &text[skip..])),
        Some((b'?', rest)) => !text.is_empty() && glob_match(rest, &text[1..]),
        Some((first, rest)) => text
            .split_first()
            .is_some_and(|(head, tail)| head == first && glob_match(rest, tail)),
    }
}

fn host_matches(patterns: &[String], host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let mut matched = false;
    for pattern in patterns {
        let pattern = pattern.to_ascii_lowercase();
        if let Some(negated) = pattern.strip_prefix('!') {
            if glob_match(negated.as_bytes(), host.as_bytes()) {
                return false;
            }
        } else if glob_match(pattern.as_bytes(), host.as_bytes()) {
            matched = true;
        }
    }
    matched
}

fn agent_path(value: Option<String>) -> Option<String> {
    let value = value?;
    let plain = unquote(&value);
    if plain.eq_ignore_ascii_case("none") || plain == "SSH_AUTH_SOCK" {
        return None;
    }
    Some(expand_home(plain).display().to_string())
}

const MAX_INCLUDE_DEPTH: usize = 16;

fn include_files(pattern: &str, base: &Path) -> Vec<PathBuf> {
    let expanded = expand_home(pattern);
    let path = if expanded.is_absolute() {
        expanded
    } else {
        base.join(expanded)
    };
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_pattern(&name) {
        return vec![path];
    }
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(parent)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|file| {
                    file.is_file()
                        && file.file_name().is_some_and(|candidate| {
                            glob_match(name.as_bytes(), candidate.to_string_lossy().as_bytes())
                        })
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

fn collect_lines(text: &str, base: &Path, depth: usize, out: &mut Vec<(String, String)>) {
    for line in text.lines() {
        let Some((key, value)) = split_line(line) else {
            continue;
        };
        if key == "include" {
            if depth >= MAX_INCLUDE_DEPTH {
                continue;
            }
            for pattern in value.split_whitespace().map(unquote) {
                for file in include_files(pattern, base) {
                    if let Ok(included) = std::fs::read_to_string(&file) {
                        collect_lines(&included, base, depth + 1, out);
                    }
                }
            }
        } else {
            out.push((key, value.to_string()));
        }
    }
}

struct Block {
    patterns: Vec<String>,
    entries: Vec<(String, String)>,
}

fn expand_tokens(value: &str, host: &str, user: Option<&str>, port: Option<u16>) -> String {
    let mut out = String::new();
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('h') => out.push_str(host),
            Some('r') => out.push_str(user.unwrap_or_default()),
            Some('p') => out.push_str(&port.unwrap_or(22).to_string()),
            Some('%') => out.push('%'),
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    out
}

fn resolve_host(alias: &str, blocks: &[Block]) -> RawHost {
    let mut host = RawHost::default();
    for block in blocks
        .iter()
        .filter(|block| host_matches(&block.patterns, alias))
    {
        for (key, value) in &block.entries {
            host.set(key, unquote(value));
        }
    }
    host.host_name = host
        .host_name
        .map(|name| expand_tokens(&name, alias, None, None));
    let target = host.host_name.clone().unwrap_or_else(|| alias.to_string());
    host.identity_file = host
        .identity_file
        .map(|file| expand_tokens(&file, &target, host.user.as_deref(), host.port));
    host
}

pub fn parse_ssh_config(text: &str) -> Vec<SshConfigHost> {
    let base = home_dir().map(|home| home.join(".ssh")).unwrap_or_default();
    parse_ssh_config_in(text, &base)
}

fn parse_ssh_config_in(text: &str, base: &Path) -> Vec<SshConfigHost> {
    let mut lines = Vec::new();
    collect_lines(text, base, 0, &mut lines);
    let mut order: Vec<String> = Vec::new();
    let mut blocks = vec![Block {
        patterns: vec!["*".to_string()],
        entries: Vec::new(),
    }];
    for (key, value) in lines {
        match key.as_str() {
            "host" => {
                let patterns: Vec<String> = value
                    .split_whitespace()
                    .map(|alias| unquote(alias).to_string())
                    .collect();
                for alias in &patterns {
                    if !is_pattern(alias) && !order.contains(alias) {
                        order.push(alias.clone());
                    }
                }
                blocks.push(Block {
                    patterns,
                    entries: Vec::new(),
                });
            }
            "match" => blocks.push(Block {
                patterns: Vec::new(),
                entries: Vec::new(),
            }),
            _ => {
                if let Some(block) = blocks.last_mut() {
                    block.entries.push((key, value));
                }
            }
        }
    }
    order
        .iter()
        .map(|alias| {
            let raw = resolve_host(alias, &blocks);
            SshConfigHost {
                alias: alias.clone(),
                host_name: raw.host_name.clone(),
                user: raw.user.clone(),
                port: raw.port,
                identity_file: raw.identity_file.clone(),
                identity_agent: agent_path(raw.identity_agent.clone()),
                proxy_jump: resolve_jumps(raw.proxy_jump.as_deref(), &blocks),
            }
        })
        .collect()
}

fn parse_jump(spec: &str) -> SshConfigJump {
    let spec = spec.trim().trim_start_matches("ssh://");
    let (user, rest) = match spec.rsplit_once('@') {
        Some((user, rest)) => (Some(user.to_string()), rest),
        None => (None, spec),
    };
    let (host, port) = if let Some(inner) = rest.strip_prefix('[') {
        match inner.split_once(']') {
            Some((host, tail)) => (
                host.to_string(),
                tail.strip_prefix(':').and_then(|p| p.parse().ok()),
            ),
            None => (inner.to_string(), None),
        }
    } else {
        match rest.rsplit_once(':') {
            Some((host, port)) if !host.contains(':') => (host.to_string(), port.parse().ok()),
            _ => (rest.to_string(), None),
        }
    };
    SshConfigJump {
        host,
        port,
        user,
        identity_file: None,
        identity_agent: None,
    }
}

fn resolve_jumps(spec: Option<&str>, blocks: &[Block]) -> Vec<SshConfigJump> {
    let Some(spec) = spec.map(str::trim).filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    if spec.eq_ignore_ascii_case("none") {
        return Vec::new();
    }
    spec.split(',')
        .map(parse_jump)
        .filter(|jump| !jump.host.is_empty())
        .map(|jump| {
            let known = resolve_host(&jump.host, blocks);
            SshConfigJump {
                host: known.host_name.clone().unwrap_or(jump.host),
                port: jump.port.or(known.port),
                user: jump.user.or_else(|| known.user.clone()),
                identity_file: known.identity_file.clone(),
                identity_agent: agent_path(known.identity_agent.clone()),
            }
        })
        .collect()
}

#[tauri::command]
pub async fn list_ssh_config_hosts() -> Result<Vec<SshConfigHost>, String> {
    let Some(home) = home_dir() else {
        return Err(
            "Home-Verzeichnis ist nicht bekannt, ~/.ssh/config kann nicht gelesen werden."
                .to_string(),
        );
    };
    let path = home.join(".ssh").join("config");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(parse_ssh_config(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!(
            "{} konnte nicht gelesen werden: {e}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_ssh_config, parse_ssh_config_in};

    #[test]
    fn resolves_includes_wildcards_tokens_and_first_value_wins() {
        let base = std::env::temp_dir().join(format!("l8db-ssh-config-{}", std::process::id()));
        std::fs::create_dir_all(base.join("config.d")).expect("dir");
        std::fs::write(
            base.join("config.d").join("orbstack"),
            "Host orb\n  HostName 127.0.0.1\n  Port 32222\n",
        )
        .expect("write");
        let hosts = parse_ssh_config_in(
            "Include config.d/*\nHost *\n  User early\nHost app.prod\n  HostName %h.example.com\nHost *.prod\n  User deploy\n  IdentityFile /keys/%r-%h\n",
            &base,
        );
        let _ = std::fs::remove_dir_all(&base);
        let aliases: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(aliases, ["orb", "app.prod"]);
        assert_eq!(hosts[0].port, Some(32222));
        let app = &hosts[1];
        assert_eq!(app.host_name.as_deref(), Some("app.prod.example.com"));
        assert_eq!(app.user.as_deref(), Some("early"));
        assert_eq!(
            app.identity_file.as_deref(),
            Some("/keys/early-app.prod.example.com")
        );
    }

    const SAMPLE: &str = r#"
# Kommentar
Host bastion
  HostName bastion.example.com
  User jump
  Port 2200
  IdentityFile /keys/jump

Host db-prod prod
    Hostname=10.0.0.5
    User deploy
    ProxyJump bastion,admin@edge.example.com:2022
    IdentityAgent "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"

Host *.internal
  User ignored

Match host foo
  User ignored-too

Host plain
  IdentityAgent SSH_AUTH_SOCK

Host *
  User fallback
  IdentityFile /keys/default
"#;

    #[test]
    fn parses_hosts_with_defaults_and_jumps() {
        let hosts = parse_ssh_config(SAMPLE);
        let aliases: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(aliases, ["bastion", "db-prod", "prod", "plain"]);

        let bastion = &hosts[0];
        assert_eq!(bastion.host_name.as_deref(), Some("bastion.example.com"));
        assert_eq!(bastion.port, Some(2200));
        assert_eq!(bastion.user.as_deref(), Some("jump"));
        assert_eq!(bastion.identity_file.as_deref(), Some("/keys/jump"));

        let prod = &hosts[1];
        assert_eq!(prod.host_name.as_deref(), Some("10.0.0.5"));
        assert_eq!(prod.user.as_deref(), Some("deploy"));
        assert_eq!(prod.identity_file.as_deref(), Some("/keys/default"));
        assert!(prod
            .identity_agent
            .as_deref()
            .unwrap()
            .ends_with("2BUA8C4S2C.com.1password/t/agent.sock"));
        assert!(!prod.identity_agent.as_deref().unwrap().starts_with('~'));
        assert_eq!(prod.proxy_jump.len(), 2);
        assert_eq!(prod.proxy_jump[0].host, "bastion.example.com");
        assert_eq!(prod.proxy_jump[0].port, Some(2200));
        assert_eq!(prod.proxy_jump[0].user.as_deref(), Some("jump"));
        assert_eq!(
            prod.proxy_jump[0].identity_file.as_deref(),
            Some("/keys/jump")
        );
        assert_eq!(prod.proxy_jump[1].host, "edge.example.com");
        assert_eq!(prod.proxy_jump[1].port, Some(2022));
        assert_eq!(prod.proxy_jump[1].user.as_deref(), Some("admin"));
        assert_eq!(
            prod.proxy_jump[1].identity_file.as_deref(),
            Some("/keys/default")
        );

        let plain = &hosts[3];
        assert_eq!(plain.user.as_deref(), Some("fallback"));
        assert_eq!(plain.identity_agent, None);
        assert!(plain.proxy_jump.is_empty());
    }

    #[test]
    fn parses_ipv6_jump_and_none() {
        let hosts =
            parse_ssh_config("Host a\n  ProxyJump root@[fe80::1]:2222\nHost b\n  ProxyJump none\n");
        assert_eq!(hosts[0].proxy_jump[0].host, "fe80::1");
        assert_eq!(hosts[0].proxy_jump[0].port, Some(2222));
        assert!(hosts[1].proxy_jump.is_empty());
    }
}
