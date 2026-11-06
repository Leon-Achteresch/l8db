use serde_json::{Map, Value};

pub const SUBKEY: &str = r"SOFTWARE\Policies\l8db";
pub const KEY: &str = r"HKLM\SOFTWARE\Policies\l8db";
pub const SIGNERS: &str = "TrustedReleaseSigners";
const REQUIRE_SIGNED: &str = "RequireSignedReleases";
const MAX_VALUE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Text,
    Json,
    Flag,
}

pub const VALUES: &[(&str, Kind, bool)] = &[
    ("Organization", Kind::Text, false),
    ("Support", Kind::Text, false),
    ("AllowAi", Kind::Flag, false),
    ("AllowExtensions", Kind::Flag, false),
    ("AllowPersonalSync", Kind::Flag, false),
    ("AllowMcp", Kind::Flag, false),
    ("Connections", Kind::Json, false),
    ("ProductionReadOnly", Kind::Flag, true),
    ("ProductionConfirmCommit", Kind::Flag, true),
    ("ProductionAutoRollback", Kind::Flag, true),
    ("ConfirmDestructiveQueries", Kind::Flag, true),
    ("SshTrustNewHosts", Kind::Flag, true),
    ("SslDefaultMode", Kind::Text, true),
    ("CrashReports", Kind::Flag, true),
    ("UsageMetrics", Kind::Flag, true),
    ("AutoUpdateCheck", Kind::Flag, true),
    ("AutoUpdateInstall", Kind::Flag, true),
    ("UpdateChannel", Kind::Text, true),
];

#[derive(Clone, Debug, PartialEq)]
pub enum RegistryValue {
    Text(String),
    Dword(u32),
    Other,
}

#[derive(Debug, PartialEq)]
pub enum Document {
    Template(Value),
    Json(String),
}

#[derive(Clone, Debug, Default)]
pub struct RegistryKey {
    pub values: Vec<(String, RegistryValue)>,
    pub subkeys: Vec<String>,
}

fn camel(name: &str) -> String {
    name[..1].to_ascii_lowercase() + &name[1..]
}

fn flag(name: &str, value: &RegistryValue) -> Result<bool, String> {
    match value {
        RegistryValue::Dword(0) => Ok(false),
        RegistryValue::Dword(1) => Ok(true),
        _ => Err(format!("{name} muss ein DWORD mit 0 oder 1 sein")),
    }
}

fn text<'a>(name: &str, value: &'a RegistryValue) -> Result<&'a str, String> {
    match value {
        RegistryValue::Text(text) => Ok(text),
        _ => Err(format!("{name} muss eine Zeichenfolge (REG_SZ) sein")),
    }
}

fn build(
    read: impl Fn(&str) -> Result<Option<RegistryKey>, String>,
) -> Result<Option<Document>, String> {
    let Some(mut root) = read(SUBKEY)? else {
        return Ok(None);
    };
    let child = |name: &str| read(&format!(r"{SUBKEY}\{name}"));
    let policy = root
        .values
        .iter()
        .position(|(name, _)| name.eq_ignore_ascii_case("Policy"))
        .map(|index| root.values.remove(index).1);
    let mut signers = Vec::new();
    for subkey in &root.subkeys {
        if !subkey.eq_ignore_ascii_case(SIGNERS) {
            return Err(format!("{subkey} ist kein l8db-Richtlinienschlüssel"));
        }
        let Some(key) = child(subkey)? else {
            continue;
        };
        if let Some(nested) = key.subkeys.first() {
            return Err(format!(
                r"{SIGNERS}\{nested} ist kein l8db-Richtlinienschlüssel"
            ));
        }
        for (name, value) in &key.values {
            signers.push(text(&format!(r"{SIGNERS}\{name}"), value)?.to_string());
        }
    }
    let mut document = Map::new();
    let mut settings = Map::new();
    let mut require = false;
    for (name, value) in &root.values {
        if name.eq_ignore_ascii_case(REQUIRE_SIGNED) {
            require = flag(REQUIRE_SIGNED, value)?;
            continue;
        }
        let Some(&(canonical, kind, setting)) = VALUES
            .iter()
            .find(|(known, ..)| known.eq_ignore_ascii_case(name))
        else {
            return Err(format!("{name} ist kein l8db-Richtlinienwert"));
        };
        let parsed = match kind {
            Kind::Flag => Value::Bool(flag(canonical, value)?),
            Kind::Text | Kind::Json => match text(canonical, value)? {
                "" => continue,
                data if kind == Kind::Text => Value::String(data.into()),
                data => serde_json::from_str(data)
                    .map_err(|_| format!("{canonical} ist kein gültiges JSON"))?,
            },
        };
        let target = if setting {
            &mut settings
        } else {
            &mut document
        };
        target.insert(camel(canonical), parsed);
    }
    if require {
        if signers.is_empty() {
            return Err(format!(
                "{REQUIRE_SIGNED} verlangt mindestens einen Eintrag unter {SIGNERS}"
            ));
        }
        document.insert(camel(REQUIRE_SIGNED), Value::Bool(true));
        document.insert(camel(SIGNERS), signers.into());
    }
    if !settings.is_empty() {
        document.insert("settings".into(), settings.into());
    }
    match policy {
        Some(_) if !document.is_empty() => Err("enthält den Wert Policy und zusätzlich einzelne Gruppenrichtlinien; nur einen Weg verwenden".into()),
        Some(json) => {
            let json = text("Policy", &json)?;
            serde_json::from_str::<serde::de::IgnoredAny>(json)
                .map_err(|_| "Policy ist kein gültiges JSON")?;
            Ok(Some(Document::Json(json.into())))
        }
        None if document.is_empty() => Ok(None),
        None => {
            document.insert("format".into(), 1.into());
            Ok(Some(Document::Template(document.into())))
        }
    }
}

fn utf16(name: &str, stored: &[u8]) -> Result<String, String> {
    let units: Vec<u16> = stored
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let end = units
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(units.len());
    String::from_utf16(&units[..end]).map_err(|_| format!("{name} enthält ungültiges UTF-16"))
}

pub fn document(
    read: impl Fn(&str) -> Result<Option<RegistryKey>, String>,
) -> Result<Option<Document>, String> {
    build(read)
        .map_err(|error| format!("Gruppenrichtlinie {KEY}: {error}. Bitte die IT kontaktieren."))
}

#[cfg(windows)]
fn read_machine_key(subkey: &str) -> Result<Option<RegistryKey>, String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, WIN32_ERROR,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE,
        KEY_READ, KEY_WOW64_64KEY, REG_DWORD, REG_SZ,
    };
    struct Opened(HKEY);
    impl Drop for Opened {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
    let failed = |code: WIN32_ERROR| format!("Registry nicht lesbar (Windows-Fehler {})", code.0);
    let wide: Vec<u16> = subkey.encode_utf16().chain([0]).collect();
    let mut handle = HKEY::default();
    let code = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(wide.as_ptr()),
            None,
            KEY_READ | KEY_WOW64_64KEY,
            &mut handle,
        )
    };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if code != ERROR_SUCCESS {
        return Err(failed(code));
    }
    let key = Opened(handle);
    let mut name = vec![0u16; 16384];
    let mut key_data = RegistryKey::default();
    let mut data = vec![0u8; 64 * 1024];
    for index in 0.. {
        let (mut kind, mut chars, mut bytes) = (0u32, 0u32, 0u32);
        let mut code = ERROR_MORE_DATA;
        for _ in 0..2 {
            chars = name.len() as u32;
            bytes = data.len() as u32;
            code = unsafe {
                RegEnumValueW(
                    key.0,
                    index,
                    Some(PWSTR(name.as_mut_ptr())),
                    &mut chars,
                    None,
                    Some(&mut kind as *mut u32),
                    Some(data.as_mut_ptr()),
                    Some(&mut bytes as *mut u32),
                )
            };
            if code != ERROR_MORE_DATA {
                break;
            }
            if bytes as usize > MAX_VALUE_BYTES {
                return Err("Ein Registry-Wert ist größer als 4 MB".into());
            }
            data.resize(bytes as usize, 0);
        }
        if code == ERROR_NO_MORE_ITEMS {
            break;
        }
        if code != ERROR_SUCCESS {
            return Err(failed(code));
        }
        let value_name = String::from_utf16_lossy(&name[..chars as usize]);
        let stored = &data[..bytes as usize];
        let value = if kind == REG_SZ.0 {
            RegistryValue::Text(utf16(&value_name, stored)?)
        } else if kind == REG_DWORD.0 && stored.len() == 4 {
            RegistryValue::Dword(u32::from_le_bytes([
                stored[0], stored[1], stored[2], stored[3],
            ]))
        } else {
            RegistryValue::Other
        };
        key_data.values.push((value_name, value));
    }
    for index in 0.. {
        let mut chars = name.len() as u32;
        let code = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut chars,
                None,
                None,
                None,
                None,
            )
        };
        if code == ERROR_NO_MORE_ITEMS {
            break;
        }
        if code != ERROR_SUCCESS {
            return Err(failed(code));
        }
        key_data
            .subkeys
            .push(String::from_utf16_lossy(&name[..chars as usize]));
    }
    Ok(Some(key_data))
}

#[cfg(windows)]
pub fn read() -> Result<Option<Document>, String> {
    use windows::Win32::System::GroupPolicy::{
        EnterCriticalPolicySection, LeaveCriticalPolicySection,
    };
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let section = unsafe { EnterCriticalPolicySection(true) };
        let _ = sender.send(document(read_machine_key));
        if let Ok(section) = section {
            let _ = unsafe { LeaveCriticalPolicySection(section) };
        }
    });
    receiver
        .recv_timeout(std::time::Duration::from_secs(3))
        .unwrap_or_else(|_| document(read_machine_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    type Keys<'a> = Vec<(&'a str, Vec<(&'a str, RegistryValue)>)>;

    fn registry(keys: Keys) -> impl Fn(&str) -> Result<Option<RegistryKey>, String> {
        let mut map: HashMap<String, RegistryKey> = HashMap::new();
        for (path, values) in &keys {
            let full = if path.is_empty() {
                SUBKEY.to_string()
            } else {
                format!(r"{SUBKEY}\{path}")
            };
            let entry = map.entry(full).or_default();
            entry.values = values
                .iter()
                .map(|(name, value)| (name.to_string(), value.clone()))
                .collect();
            if !path.is_empty() {
                map.entry(SUBKEY.into())
                    .or_default()
                    .subkeys
                    .push(path.to_string());
            }
        }
        move |path| Ok(map.get(path).cloned())
    }

    fn sz(data: &str) -> RegistryValue {
        RegistryValue::Text(data.into())
    }

    fn parsed(read: impl Fn(&str) -> Result<Option<RegistryKey>, String>) -> Option<Value> {
        document(read).unwrap().map(|document| match document {
            Document::Template(value) => value,
            Document::Json(text) => serde_json::from_str(&text).unwrap(),
        })
    }

    #[test]
    fn group_policy_builds_the_policy_from_template_values() {
        use RegistryValue::Dword;
        let read = registry(vec![
            (
                "",
                vec![
                    ("organization", sz("Beispiel AG")),
                    ("Support", sz("")),
                    ("AllowAi", Dword(0)),
                    ("AllowMcp", Dword(1)),
                    ("Connections", sz(r#"[{"id":"reporting"}]"#)),
                    ("PRODUCTIONREADONLY", Dword(1)),
                    ("SshTrustNewHosts", Dword(0)),
                    ("SslDefaultMode", sz("verify-full")),
                    ("UpdateChannel", sz("stable")),
                    ("RequireSignedReleases", Dword(1)),
                ],
            ),
            (
                "trustedreleasesigners",
                vec![("1", sz("SHA256:abc")), ("2", sz("SHA256:def"))],
            ),
        ]);
        assert_eq!(
            parsed(read).unwrap(),
            serde_json::json!({
                "format": 1,
                "organization": "Beispiel AG",
                "allowAi": false,
                "allowMcp": true,
                "connections": [{"id": "reporting"}],
                "requireSignedReleases": true,
                "trustedReleaseSigners": ["SHA256:abc", "SHA256:def"],
                "settings": {
                    "productionReadOnly": true,
                    "sshTrustNewHosts": false,
                    "sslDefaultMode": "verify-full",
                    "updateChannel": "stable"
                }
            })
        );
    }

    #[test]
    fn group_policy_without_restrictions_is_no_policy() {
        use RegistryValue::Dword;
        assert_eq!(parsed(registry(vec![])), None);
        let disabled = registry(vec![
            (
                "",
                vec![("RequireSignedReleases", Dword(0)), ("Support", sz(""))],
            ),
            ("TrustedReleaseSigners", vec![]),
        ]);
        assert_eq!(parsed(disabled), None);
        let ignored = registry(vec![
            (
                "",
                vec![("RequireSignedReleases", Dword(0)), ("AllowAi", Dword(0))],
            ),
            ("TrustedReleaseSigners", vec![("1", sz("SHA256:abc"))]),
        ]);
        assert_eq!(
            parsed(ignored).unwrap(),
            serde_json::json!({"format": 1, "allowAi": false})
        );
    }

    #[test]
    fn group_policy_reads_the_whole_policy_json_value() {
        let read = registry(vec![(
            "",
            vec![("POLICY", sz(r#"{"format":1,"allowAi":false}"#))],
        )]);
        assert_eq!(
            parsed(read).unwrap(),
            serde_json::json!({"format": 1, "allowAi": false})
        );
        let leftover = registry(vec![
            (
                "",
                vec![
                    (
                        "Policy",
                        sz(r#"{"format":1,"allowAi":false,"allowAi":true}"#),
                    ),
                    ("RequireSignedReleases", RegistryValue::Dword(0)),
                ],
            ),
            ("TrustedReleaseSigners", vec![("1", sz("SHA256:abc"))]),
        ]);
        assert_eq!(
            document(leftover).unwrap(),
            Some(Document::Json(
                r#"{"format":1,"allowAi":false,"allowAi":true}"#.into()
            ))
        );
    }

    #[test]
    fn group_policy_refuses_values_the_template_does_not_write() {
        use RegistryValue::{Dword, Other};
        let cases: Vec<(Keys, &str)> = vec![
            (
                vec![("", vec![("AllowAi", Dword(2))])],
                "AllowAi muss ein DWORD",
            ),
            (
                vec![("", vec![("AllowAi", sz("0"))])],
                "AllowAi muss ein DWORD",
            ),
            (
                vec![("", vec![("Organization", Other)])],
                "Organization muss eine Zeichenfolge",
            ),
            (
                vec![("", vec![("Organization", Dword(1))])],
                "Organization muss eine Zeichenfolge",
            ),
            (
                vec![("", vec![("Connections", sz("[{"))])],
                "Connections ist kein gültiges JSON",
            ),
            (
                vec![("", vec![("Bypass", Dword(1))])],
                "Bypass ist kein l8db-Richtlinienwert",
            ),
            (
                vec![("Extra", vec![])],
                "Extra ist kein l8db-Richtlinienschlüssel",
            ),
            (
                vec![("TrustedReleaseSigners", vec![("1", Dword(1))])],
                r"TrustedReleaseSigners\1 muss eine Zeichenfolge",
            ),
            (
                vec![("", vec![("RequireSignedReleases", Dword(1))])],
                "RequireSignedReleases verlangt mindestens einen Eintrag",
            ),
            (
                vec![("", vec![("Policy", sz("{}")), ("AllowAi", Dword(0))])],
                "nur einen Weg verwenden",
            ),
            (
                vec![
                    (
                        "",
                        vec![("Policy", sz("{}")), ("RequireSignedReleases", Dword(1))],
                    ),
                    ("TrustedReleaseSigners", vec![("1", sz("SHA256:abc"))]),
                ],
                "nur einen Weg verwenden",
            ),
            (
                vec![("", vec![("Policy", sz("{}"))]), ("Extra", vec![])],
                "Extra ist kein l8db-Richtlinienschlüssel",
            ),
            (
                vec![("", vec![("Policy", Other)])],
                "Policy muss eine Zeichenfolge",
            ),
            (
                vec![("", vec![("Policy", sz("{"))])],
                "Policy ist kein gültiges JSON",
            ),
        ];
        for (keys, expected) in cases {
            let error = document(registry(keys)).unwrap_err();
            assert!(
                error.starts_with(r"Gruppenrichtlinie HKLM\SOFTWARE\Policies\l8db: ")
                    && error.contains(expected),
                "{error}"
            );
        }
        let nested = |path: &str| {
            Ok(Some(RegistryKey {
                values: Vec::new(),
                subkeys: if path == SUBKEY {
                    vec![SIGNERS.into()]
                } else {
                    vec!["Deeper".into()]
                },
            }))
        };
        assert!(document(nested)
            .unwrap_err()
            .contains(r"TrustedReleaseSigners\Deeper ist kein"));
        let failing = |_: &str| {
            Err::<Option<RegistryKey>, _>("Registry nicht lesbar (Windows-Fehler 5)".to_string())
        };
        assert!(document(failing).unwrap_err().contains("Windows-Fehler 5"));
    }

    #[test]
    fn group_policy_decodes_reg_sz_up_to_the_first_nul() {
        let wide =
            |text: &str| -> Vec<u8> { text.encode_utf16().flat_map(u16::to_le_bytes).collect() };
        assert_eq!(utf16("A", &wide("Beispiel AG")).unwrap(), "Beispiel AG");
        assert_eq!(utf16("A", &wide("Beispiel AG\0")).unwrap(), "Beispiel AG");
        assert_eq!(utf16("A", &wide("stable\0canary\0")).unwrap(), "stable");
        let mut odd = wide("Be");
        odd.push(0x41);
        assert_eq!(utf16("A", &odd).unwrap(), "Be");
        assert_eq!(utf16("A", &[]).unwrap(), "");
        assert!(utf16("Organization", &[0x00, 0xd8])
            .unwrap_err()
            .contains("Organization enthält ungültiges UTF-16"));
    }

    #[test]
    fn group_policy_template_covers_every_registry_value() {
        let admx = include_str!("../policy/l8db.admx");
        let names: Vec<&str> = VALUES
            .iter()
            .map(|(name, ..)| *name)
            .chain([REQUIRE_SIGNED])
            .collect();
        for name in &names {
            assert!(admx.contains(&format!(r#"valueName="{name}""#)), "{name}");
        }
        assert!(admx.contains(&format!(r#"key="{SUBKEY}\{SIGNERS}""#)));
        assert!(!admx.contains("expandable"));
        for (name, kind, _) in VALUES.iter().chain([&(REQUIRE_SIGNED, Kind::Flag, false)]) {
            let at = admx.find(&format!(r#"valueName="{name}""#)).unwrap();
            let tag = admx[..at].rsplit('<').next().unwrap();
            let tag = tag.split_whitespace().next().unwrap();
            let expected: &[&str] = match kind {
                Kind::Flag => &["policy"],
                Kind::Text => &["text", "enum"],
                Kind::Json => &["text"],
            };
            assert!(expected.contains(&tag), "{name}: {tag}");
            if *kind == Kind::Flag {
                let block = &admx[at..at + admx[at..].find("</policy>").unwrap()];
                assert!(
                    block.contains(r#"<enabledValue><decimal value="1" /></enabledValue>"#)
                        && block
                            .contains(r#"<disabledValue><decimal value="0" /></disabledValue>"#),
                    "{name}"
                );
            }
        }
        for written in admx.split(r#"valueName=""#).skip(1) {
            let name = &written[..written.find('"').unwrap()];
            assert!(names.contains(&name), "{name}");
        }
        for key in admx.split(r#"key=""#).skip(1) {
            let key = &key[..key.find('"').unwrap()];
            assert!(
                key == SUBKEY || key == format!(r"{SUBKEY}\{SIGNERS}"),
                "{key}"
            );
        }
        let references = |prefix: &str| -> Vec<String> {
            admx.split(prefix)
                .skip(1)
                .map(|rest| rest[..rest.find(')').unwrap()].to_string())
                .collect()
        };
        let elements: Vec<&str> = admx
            .split("<elements>")
            .skip(1)
            .flat_map(|block| {
                block[..block.find("</elements>").unwrap()]
                    .split(r#" id=""#)
                    .skip(1)
            })
            .map(|rest| &rest[..rest.find('"').unwrap()])
            .collect();
        for adml in [
            include_str!("../policy/de-DE/l8db.adml"),
            include_str!("../policy/en-US/l8db.adml"),
        ] {
            for id in references("$(string.") {
                assert!(adml.contains(&format!(r#"<string id="{id}">"#)), "{id}");
            }
            for id in references("$(presentation.") {
                assert!(
                    adml.contains(&format!(r#"<presentation id="{id}">"#)),
                    "{id}"
                );
            }
            for id in &elements {
                assert!(adml.contains(&format!(r#"refId="{id}""#)), "{id}");
            }
            assert_eq!(adml.matches(" refId=").count(), elements.len());
        }
    }
}
