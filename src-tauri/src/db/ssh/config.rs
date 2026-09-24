use std::collections::HashMap;

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

    fn inherit(&mut self, defaults: &RawHost) {
        fill_from(&mut self.host_name, &defaults.host_name);
        fill_from(&mut self.user, &defaults.user);
        if self.port.is_none() {
            self.port = defaults.port;
        }
        fill_from(&mut self.identity_file, &defaults.identity_file);
        fill_from(&mut self.identity_agent, &defaults.identity_agent);
        fill_from(&mut self.proxy_jump, &defaults.proxy_jump);
    }
}

fn fill(slot: &mut Option<String>, value: String) {
    if slot.is_none() {
        *slot = Some(value);
    }
}

fn fill_from(slot: &mut Option<String>, value: &Option<String>) {
    if slot.is_none() {
        slot.clone_from(value);
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

fn agent_path(value: Option<String>) -> Option<String> {
    let value = value?;
    let plain = unquote(&value);
    if plain.eq_ignore_ascii_case("none") || plain == "SSH_AUTH_SOCK" {
        return None;
    }
    Some(expand_home(plain).display().to_string())
}

pub fn parse_ssh_config(text: &str) -> Vec<SshConfigHost> {
    let mut order: Vec<String> = Vec::new();
    let mut hosts: HashMap<String, RawHost> = HashMap::new();
    let mut defaults = RawHost::default();
    let mut current: Vec<String> = Vec::new();
    let mut in_defaults = false;
    for line in text.lines() {
        let Some((key, value)) = split_line(line) else {
            continue;
        };
        match key.as_str() {
            "host" => {
                current.clear();
                in_defaults = false;
                for alias in value.split_whitespace().map(unquote) {
                    if alias == "*" {
                        in_defaults = true;
                    } else if !is_pattern(alias) {
                        if !hosts.contains_key(alias) {
                            order.push(alias.to_string());
                            hosts.insert(alias.to_string(), RawHost::default());
                        }
                        current.push(alias.to_string());
                    }
                }
            }
            "match" => {
                current.clear();
                in_defaults = false;
            }
            _ => {
                let value = unquote(value);
                if in_defaults {
                    defaults.set(&key, value);
                }
                for alias in &current {
                    if let Some(host) = hosts.get_mut(alias) {
                        host.set(&key, value);
                    }
                }
            }
        }
    }
    for host in hosts.values_mut() {
        host.inherit(&defaults);
    }
    order
        .iter()
        .filter_map(|alias| {
            let raw = hosts.get(alias)?;
            Some(SshConfigHost {
                alias: alias.clone(),
                host_name: raw.host_name.clone(),
                user: raw.user.clone(),
                port: raw.port,
                identity_file: raw.identity_file.clone(),
                identity_agent: agent_path(raw.identity_agent.clone()),
                proxy_jump: resolve_jumps(raw.proxy_jump.as_deref(), &hosts, &defaults),
            })
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

fn resolve_jumps(
    spec: Option<&str>,
    hosts: &HashMap<String, RawHost>,
    defaults: &RawHost,
) -> Vec<SshConfigJump> {
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
            let known = hosts.get(&jump.host).unwrap_or(defaults);
            SshConfigJump {
                host: known
                    .host_name
                    .clone()
                    .filter(|_| hosts.contains_key(&jump.host))
                    .unwrap_or(jump.host),
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
    use super::parse_ssh_config;

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
