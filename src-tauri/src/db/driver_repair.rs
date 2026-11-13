use std::path::{Path, PathBuf};

use serde::Serialize;

use super::provider::{install_command, install_driver, oracle_hints, DriverStatus};
use super::DatabaseKind;

const MAX_FINDINGS_PER_CAUSE: usize = 3;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DriverFinding {
    pub level: &'static str,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverDiagnosis {
    pub status: DriverStatus,
    pub findings: Vec<DriverFinding>,
    pub steps: Vec<String>,
    pub manual: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverRepair {
    pub log: String,
    pub diagnosis: DriverDiagnosis,
}

#[derive(Debug, Default, PartialEq)]
struct ClientScan {
    searched: usize,
    usable: Vec<PathBuf>,
    dangling: Vec<(PathBuf, PathBuf)>,
    foreign: Vec<(PathBuf, &'static str)>,
}

#[derive(Debug, PartialEq)]
enum Step {
    RemoveLinks(Vec<PathBuf>),
    Unquarantine(Vec<PathBuf>),
    Install,
}

impl Step {
    fn label(&self) -> String {
        match self {
            Step::RemoveLinks(links) => format!("Tote Verweise entfernen ({})", links.len()),
            Step::Unquarantine(_) => "Quarantäne aufheben".to_string(),
            Step::Install => "Instant Client installieren".to_string(),
        }
    }
}

fn binary_arch(path: &Path) -> Option<&'static str> {
    use std::io::Read;
    let mut head = Vec::with_capacity(4096);
    std::fs::File::open(path)
        .ok()?
        .take(4096)
        .read_to_end(&mut head)
        .ok()?;
    let u16_at = |at: usize| {
        head.get(at..at + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
    };
    let u32_at = |at: usize| {
        head.get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    match head.get(..4)? {
        [0xcf, 0xfa, 0xed, 0xfe] => match u32_at(4)? {
            0x0100_000c => Some("aarch64"),
            0x0100_0007 => Some("x86_64"),
            _ => None,
        },
        [0x7f, b'E', b'L', b'F'] => match u16_at(18)? {
            183 => Some("aarch64"),
            62 => Some("x86_64"),
            3 => Some("x86"),
            _ => None,
        },
        [b'M', b'Z', ..] => match u16_at(u32_at(0x3c)? as usize + 4)? {
            0xaa64 => Some("aarch64"),
            0x8664 => Some("x86_64"),
            0x014c => Some("x86"),
            _ => None,
        },
        _ => None,
    }
}

fn missing(path: &Path) -> bool {
    matches!(path.try_exists(), Ok(false))
}

fn detachable(target: &Path) -> bool {
    ["/Volumes", "/mnt", "/media", "/run/media"]
        .iter()
        .any(|root| target.starts_with(root))
}

fn scan_clients(candidates: impl Iterator<Item = PathBuf>) -> ClientScan {
    let mut scan = ClientScan::default();
    let mut seen = std::collections::HashSet::new();
    for dir in candidates {
        if !seen.insert(dir.clone()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        scan.searched += 1;
        let mut libs: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| super::oracle::is_client_lib(&entry.file_name().to_string_lossy()))
            .map(|entry| entry.path())
            .collect();
        libs.sort();
        if let Some(lib) = libs.iter().find(|lib| lib.exists()) {
            match binary_arch(lib) {
                Some(arch) if arch != std::env::consts::ARCH => scan.foreign.push((dir, arch)),
                _ => scan.usable.push(dir),
            }
        } else if let Some(link) = libs.into_iter().find(|lib| missing(lib)) {
            match std::fs::read_link(&link) {
                Ok(target) if !detachable(&target) => scan.dangling.push((link, target)),
                _ => {}
            }
        }
    }
    scan
}

fn dead_links(link: &Path, target: &Path) -> Vec<PathBuf> {
    let gone = target.parent().filter(|dir| !dir.as_os_str().is_empty());
    let (Some(dir), Some(gone)) = (link.parent(), gone) else {
        return vec![link.to_path_buf()];
    };
    let mut links: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    missing(path)
                        && std::fs::read_link(path).is_ok_and(|to| to.parent() == Some(gone))
                })
                .collect()
        })
        .unwrap_or_default();
    links.sort();
    links
}

fn remove_dead_link(link: &Path) -> bool {
    std::fs::symlink_metadata(link).is_ok_and(|meta| meta.file_type().is_symlink())
        && missing(link)
        && std::fs::remove_file(link).is_ok()
}

fn quarantined(dir: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let lib = dir.join("libclntsh.dylib").canonicalize().ok()?;
    let folder = lib.parent()?;
    let named = folder
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with("instantclient"));
    let flagged = crate::process::std_command("xattr")
        .args(["-p", "com.apple.quarantine"])
        .arg(&lib)
        .output()
        .is_ok_and(|output| output.status.success());
    (named && flagged).then(|| folder.to_path_buf())
}

fn short(path: &Path) -> String {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    match home.and_then(|home| path.strip_prefix(home).ok().map(Path::to_path_buf)) {
        Some(rest) => format!("~/{}", rest.display()),
        None => path.display().to_string(),
    }
}

fn finding(
    level: &'static str,
    title: impl Into<String>,
    detail: impl Into<String>,
) -> DriverFinding {
    DriverFinding {
        level,
        title: title.into(),
        detail: detail.into(),
    }
}

fn assess(
    scan: &ClientScan,
    loaded: &Result<String, String>,
    blocked: &[PathBuf],
    installable: Result<&str, String>,
) -> (Vec<DriverFinding>, Vec<Step>, Option<String>) {
    let error = match loaded {
        Ok(version) => {
            let detail = scan
                .usable
                .first()
                .map(|dir| short(dir))
                .unwrap_or_default();
            let ok = finding("ok", format!("Instant Client {version} geladen"), detail);
            return (vec![ok], vec![], None);
        }
        Err(error) => error,
    };
    let mut findings = Vec::new();
    for (link, target) in scan.dangling.iter().take(MAX_FINDINGS_PER_CAUSE) {
        findings.push(finding(
            "error",
            "Verweis zeigt auf fehlenden Ordner",
            format!(
                "{} → {}",
                short(link),
                short(target.parent().unwrap_or(target))
            ),
        ));
    }
    for (dir, arch) in scan.foreign.iter().take(MAX_FINDINGS_PER_CAUSE) {
        findings.push(finding(
            "error",
            format!(
                "Falsche Architektur ({arch} statt {})",
                std::env::consts::ARCH
            ),
            short(dir),
        ));
    }
    for dir in blocked.iter().take(MAX_FINDINGS_PER_CAUSE) {
        findings.push(finding(
            "error",
            "Von macOS blockiert (Quarantäne)",
            short(dir),
        ));
    }
    let libaio = error.contains("libaio");
    let mut manual = None;
    if libaio {
        findings.push(finding(
            "error",
            "Systembibliothek libaio fehlt",
            "libaio.so.1",
        ));
        manual = Some("(sudo apt install -y libaio1t64 || sudo apt install -y libaio1) && ([ -e /usr/lib/x86_64-linux-gnu/libaio.so.1 ] || sudo ln -sf libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1)".to_string());
    }
    if findings.is_empty() {
        findings.push(match scan.usable.first() {
            Some(dir) => finding(
                "error",
                "Instant Client lässt sich nicht laden",
                format!(
                    "{}: {}",
                    short(dir),
                    error
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .chars()
                        .take(300)
                        .collect::<String>()
                ),
            ),
            None => finding(
                "error",
                "Kein Instant Client gefunden",
                format!("{} Ordner durchsucht", scan.searched),
            ),
        });
    }
    let mut steps = Vec::new();
    let links: Vec<PathBuf> = scan
        .dangling
        .iter()
        .flat_map(|(link, target)| dead_links(link, target))
        .collect();
    if !links.is_empty() {
        steps.push(Step::RemoveLinks(links));
    }
    if !blocked.is_empty() {
        steps.push(Step::Unquarantine(blocked.to_vec()));
    }
    if blocked.is_empty() && !libaio {
        match installable {
            Ok(_) => steps.push(Step::Install),
            Err(instructions) => manual = Some(instructions),
        }
    }
    (findings, steps, manual)
}

fn load_client() -> Result<String, String> {
    super::oracle::ensure_client_lib();
    oracle::Version::client()
        .map(|version| version.to_string())
        .map_err(|error| error.to_string())
}

fn load_error(dir: &Path) -> Option<String> {
    oracle::InitParams::new()
        .oracle_client_lib_dir(dir)
        .and_then(|params| params.init())
        .err()
        .map(|error| error.to_string())
}

fn inspect() -> (DriverDiagnosis, Vec<Step>) {
    let mut loaded = load_client();
    let mut scan = ClientScan::default();
    let mut blocked = Vec::new();
    if loaded.is_ok() {
        scan.usable.extend(super::oracle::find_client_lib_dir());
    } else {
        scan = scan_clients(super::oracle::client_lib_candidates());
        if let Some(error) = scan.usable.first().and_then(|dir| load_error(dir)) {
            loaded = Err(error);
        }
        blocked = scan
            .usable
            .iter()
            .filter_map(|dir| quarantined(dir))
            .collect();
        blocked.sort();
        blocked.dedup();
    }
    let (findings, steps, manual) = assess(
        &scan,
        &loaded,
        &blocked,
        install_command(DatabaseKind::Oracle),
    );
    let title = findings
        .first()
        .map(|finding| finding.title.as_str())
        .unwrap_or_default();
    let status = DriverStatus {
        available: loaded.is_ok(),
        detail: if loaded.is_ok() {
            format!("Oracle {title}")
        } else {
            format!("Oracle Instant Client: {title}")
        },
        install: if loaded.is_ok() {
            vec![]
        } else {
            oracle_hints()
        },
        install_command: install_command(DatabaseKind::Oracle)
            .ok()
            .map(str::to_string),
    };
    let diagnosis = DriverDiagnosis {
        status,
        findings,
        steps: steps.iter().map(Step::label).collect(),
        manual,
    };
    (diagnosis, steps)
}

async fn inspect_blocking() -> Result<(DriverDiagnosis, Vec<Step>), String> {
    tokio::task::spawn_blocking(inspect)
        .await
        .map_err(|e| format!("Treiberanalyse fehlgeschlagen: {e}"))
}

const UNSUPPORTED: &str = "Für diesen Treiber gibt es keine Analyse.";

pub async fn diagnose(kind: DatabaseKind) -> Result<DriverDiagnosis, String> {
    if kind != DatabaseKind::Oracle {
        return Err(UNSUPPORTED.to_string());
    }
    Ok(inspect_blocking().await?.0)
}

pub async fn repair(kind: DatabaseKind) -> Result<DriverRepair, String> {
    if kind != DatabaseKind::Oracle {
        return Err(UNSUPPORTED.to_string());
    }
    let mut log = Vec::new();
    for step in inspect_blocking().await?.1 {
        match step {
            Step::RemoveLinks(links) => {
                let removed = links.iter().filter(|link| remove_dead_link(link)).count();
                log.push(format!(
                    "{removed} von {} toten Verweisen entfernt.",
                    links.len()
                ));
            }
            Step::Unquarantine(dirs) => {
                for dir in dirs {
                    let done = crate::process::command("xattr")
                        .args(["-dr", "com.apple.quarantine"])
                        .arg(&dir)
                        .output()
                        .await
                        .is_ok_and(|output| output.status.success());
                    log.push(format!(
                        "Quarantäne für {} {}.",
                        short(&dir),
                        if done {
                            "aufgehoben"
                        } else {
                            "nicht aufgehoben"
                        }
                    ));
                }
            }
            Step::Install => log.push(match install_driver(kind).await {
                Ok(output) => output,
                Err(error) => error,
            }),
        }
    }
    Ok(DriverRepair {
        log: log.join("\n"),
        diagnosis: diagnose(kind).await?,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn lib_name() -> &'static str {
        if cfg!(target_os = "macos") {
            "libclntsh.dylib"
        } else {
            "libclntsh.so"
        }
    }

    fn foreign_header() -> Vec<u8> {
        let mut head = vec![0xcf, 0xfa, 0xed, 0xfe];
        let cpu: u32 = if std::env::consts::ARCH == "aarch64" {
            0x0100_0007
        } else {
            0x0100_000c
        };
        head.extend(cpu.to_le_bytes());
        head.extend([0u8; 24]);
        head
    }

    fn load_failure() -> Result<String, String> {
        Err("DPI-1047: Cannot locate a 64-bit Oracle Client library".to_string())
    }

    #[test]
    fn reads_architecture_from_binary_headers() {
        let dir = tempfile::tempdir().unwrap();
        let write = |name: &str, bytes: Vec<u8>| {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        };
        let mut macho = vec![0xcf, 0xfa, 0xed, 0xfe];
        macho.extend(0x0100_000cu32.to_le_bytes());
        let mut elf = vec![0x7f, b'E', b'L', b'F'];
        elf.extend([0u8; 14]);
        elf.extend(62u16.to_le_bytes());
        let mut pe = vec![0u8; 0x90];
        pe[0] = b'M';
        pe[1] = b'Z';
        pe[0x3c] = 0x80;
        pe[0x84..0x86].copy_from_slice(&0x014cu16.to_le_bytes());
        assert_eq!(binary_arch(&write("macho", macho)), Some("aarch64"));
        assert_eq!(binary_arch(&write("elf", elf)), Some("x86_64"));
        assert_eq!(binary_arch(&write("pe", pe)), Some("x86"));
        assert_eq!(binary_arch(&write("text", b"plain".to_vec())), None);
        assert_eq!(binary_arch(&dir.path().join("absent")), None);
    }

    #[test]
    fn deleted_client_folder_is_explained_and_only_its_links_are_removed() {
        let root = tempfile::tempdir().unwrap();
        let lib = root.path().join("lib");
        let gone = root.path().join("Downloads/instantclient_23_3");
        std::fs::create_dir_all(&lib).unwrap();
        for name in [lib_name(), "libnnz.dylib", "libocci.dylib"] {
            symlink(gone.join(name), lib.join(name)).unwrap();
        }
        symlink(root.path().join("elsewhere/other"), lib.join("other")).unwrap();
        std::fs::write(lib.join("keep.txt"), "x").unwrap();

        let scan = scan_clients([lib.clone(), lib.clone(), root.path().join("absent")].into_iter());
        assert_eq!(scan.searched, 1);
        assert!(scan.usable.is_empty());
        assert_eq!(
            scan.dangling,
            vec![(lib.join(lib_name()), gone.join(lib_name()))]
        );

        let (findings, steps, manual) = assess(&scan, &load_failure(), &[], Ok("install"));
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].title, "Verweis zeigt auf fehlenden Ordner");
        assert!(findings[0].detail.ends_with("instantclient_23_3"));
        assert_eq!(manual, None);
        let Step::RemoveLinks(links) = &steps[0] else {
            panic!("expected link removal first");
        };
        assert_eq!(links.len(), 3);
        assert_eq!(steps[1], Step::Install);

        assert_eq!(
            links.iter().filter(|link| remove_dead_link(link)).count(),
            3
        );
        assert!(std::fs::symlink_metadata(lib.join("other")).is_ok());
        assert!(lib.join("keep.txt").exists());
        assert!(!remove_dead_link(&lib.join("keep.txt")));
    }

    #[test]
    fn links_to_detached_volumes_are_not_treated_as_dead() {
        let root = tempfile::tempdir().unwrap();
        symlink(
            Path::new("/Volumes/l8db-absent/instantclient").join(lib_name()),
            root.path().join(lib_name()),
        )
        .unwrap();
        let scan = scan_clients([root.path().to_path_buf()].into_iter());
        assert!(scan.dangling.is_empty());
        let (findings, steps, _) = assess(&scan, &load_failure(), &[], Ok("install"));
        assert_eq!(findings[0].title, "Kein Instant Client gefunden");
        assert_eq!(steps, vec![Step::Install]);
        assert!(std::fs::symlink_metadata(root.path().join(lib_name())).is_ok());
    }

    #[test]
    fn sibling_links_are_left_alone_without_a_target_folder() {
        let root = tempfile::tempdir().unwrap();
        symlink("libclntsh.23.1", root.path().join(lib_name())).unwrap();
        symlink("libfoo.1", root.path().join("libfoo")).unwrap();
        let link = root.path().join(lib_name());
        assert_eq!(dead_links(&link, Path::new("libclntsh.23.1")), vec![link]);
    }

    #[test]
    fn causes_map_to_matching_solutions() {
        let root = tempfile::tempdir().unwrap();
        let wrong = root.path().join("wrong");
        let good = root.path().join("good");
        for dir in [&wrong, &good] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(wrong.join(lib_name()), foreign_header()).unwrap();
        std::fs::write(good.join(lib_name()), b"client").unwrap();
        let scan = scan_clients([wrong.clone(), good.clone()].into_iter());
        assert_eq!(scan.foreign.len(), 1);
        assert_eq!(scan.usable, vec![good.clone()]);

        let (findings, steps, _) = assess(&scan, &Ok("23.3.0.23.9".into()), &[], Ok("install"));
        assert_eq!(findings[0].level, "ok");
        assert!(steps.is_empty());

        let (findings, steps, _) = assess(&scan, &load_failure(), &[good.clone()], Ok("install"));
        assert!(findings
            .iter()
            .any(|f| f.title.starts_with("Falsche Architektur")));
        assert!(findings.iter().any(|f| f.title.contains("Quarantäne")));
        assert_eq!(steps, vec![Step::Unquarantine(vec![good.clone()])]);

        let only_good = scan_clients([good].into_iter());
        let (findings, steps, manual) = assess(
            &only_good,
            &load_failure(),
            &[],
            Err("Manuell installieren".into()),
        );
        assert_eq!(findings[0].title, "Instant Client lässt sich nicht laden");
        assert!(steps.is_empty());
        assert_eq!(manual.as_deref(), Some("Manuell installieren"));

        let libaio = Err("DPI-1047: libaio.so.1: cannot open shared object file".to_string());
        let (findings, steps, manual) = assess(&only_good, &libaio, &[], Ok("install"));
        assert_eq!(findings[0].title, "Systembibliothek libaio fehlt");
        assert!(steps.is_empty());
        assert!(manual.is_some_and(|text| text.contains("libaio1")));

        let (findings, steps, _) = assess(
            &ClientScan {
                searched: 4,
                ..Default::default()
            },
            &load_failure(),
            &[],
            Ok("install"),
        );
        assert_eq!(findings[0].detail, "4 Ordner durchsucht");
        assert_eq!(steps, vec![Step::Install]);
    }

    #[test]
    fn scan_stays_bounded_on_large_directories() {
        const DIRS: usize = 8;
        const FILES: usize = 2_000;
        const LINKS: usize = 300;
        let root = tempfile::tempdir().unwrap();
        let gone = root.path().join("gone");
        let mut candidates = Vec::new();
        for index in 0..DIRS {
            let dir = root.path().join(format!("dir{index}"));
            std::fs::create_dir_all(&dir).unwrap();
            for file in 0..FILES {
                std::fs::write(dir.join(format!("lib{file}.bin")), b"").unwrap();
            }
            symlink(gone.join(lib_name()), dir.join(lib_name())).unwrap();
            for link in 0..LINKS {
                symlink(gone.join(format!("l{link}")), dir.join(format!("l{link}"))).unwrap();
            }
            candidates.push(dir);
        }
        let mut samples = Vec::new();
        let mut result = None;
        for _ in 0..7 {
            let started = std::time::Instant::now();
            let scan = scan_clients(candidates.clone().into_iter());
            let assessed = assess(&scan, &load_failure(), &[], Ok("install"));
            samples.push(started.elapsed());
            result = Some((scan, assessed));
        }
        samples.sort();
        let (scan, (findings, steps, _)) = result.unwrap();
        println!(
            "driver scan: {DIRS} dirs x {} entries, median {:?}, p95 {:?}",
            FILES + LINKS + 1,
            samples[3],
            samples[6]
        );
        assert_eq!(scan.dangling.len(), DIRS);
        assert_eq!(findings.len(), MAX_FINDINGS_PER_CAUSE);
        assert_eq!(steps.len(), 2);
        let Step::RemoveLinks(links) = &steps[0] else {
            panic!("expected link removal first");
        };
        assert_eq!(links.len(), DIRS * (LINKS + 1));
        assert!(
            samples[3] < std::time::Duration::from_millis(400),
            "median {:?}",
            samples[3]
        );
        assert!(
            samples[6] < std::time::Duration::from_millis(800),
            "p95 {:?}",
            samples[6]
        );
    }
}
