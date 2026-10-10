use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use zeroize::Zeroizing;

pub const MEMORY_KIB: u32 = 64 * 1024;
pub const ITERATIONS: u32 = 3;
pub const PARALLELISM: u32 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 64;
const MAX_ENVELOPE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KdfParams {
    pub alg: String,
    pub m: u32,
    pub t: u32,
    pub p: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub kdf: KdfParams,
    pub cipher: String,
    pub nonce: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sealed {
    pub envelope: String,
    pub fingerprint: String,
    pub salt: String,
}

type DerivedKey = Zeroizing<[u8; KEY_LEN]>;

struct CachedKey {
    passphrase: [u8; 32],
    kdf: KdfParams,
    key: DerivedKey,
}

static KEY_CACHE: Mutex<Option<CachedKey>> = Mutex::new(None);

fn passphrase_digest(passphrase: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(
        ring::digest::digest(&ring::digest::SHA256, passphrase.as_bytes()).as_ref(),
    );
    out
}

fn validate(kdf: &KdfParams) -> Result<Vec<u8>, String> {
    if kdf.alg != "argon2id" {
        return Err("Unbekanntes Schlüsselableitungsverfahren in den Sync-Daten.".into());
    }
    if !(19 * 1024..=1024 * 1024).contains(&kdf.m)
        || !(1..=10).contains(&kdf.t)
        || !(1..=8).contains(&kdf.p)
    {
        return Err("Ungültige Argon2-Parameter in den Sync-Daten.".into());
    }
    let salt = STANDARD
        .decode(&kdf.salt)
        .map_err(|_| "Ungültiges Salt in den Sync-Daten.".to_string())?;
    if salt.len() < 16 || salt.len() > 64 {
        return Err("Ungültiges Salt in den Sync-Daten.".into());
    }
    Ok(salt)
}

fn derive(passphrase: &str, kdf: &KdfParams) -> Result<DerivedKey, String> {
    let salt = validate(kdf)?;
    let digest = passphrase_digest(passphrase);
    if let Ok(cache) = KEY_CACHE.lock() {
        if let Some(cached) = cache.as_ref() {
            if cached.passphrase == digest && &cached.kdf == kdf {
                return Ok(cached.key.clone());
            }
        }
    }
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(KEY_LEN))
        .map_err(|e| format!("Argon2-Parameter ungültig: {e}"))?;
    let mut key: DerivedKey = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), &salt, key.as_mut())
        .map_err(|e| format!("Schlüsselableitung fehlgeschlagen: {e}"))?;
    if let Ok(mut cache) = KEY_CACHE.lock() {
        *cache = Some(CachedKey {
            passphrase: digest,
            kdf: kdf.clone(),
            key: key.clone(),
        });
    }
    Ok(key)
}

fn associated(kdf: &KdfParams) -> Vec<u8> {
    format!(
        "l8db-sync-v1|{}|{}|{}|{}|{}",
        kdf.alg, kdf.m, kdf.t, kdf.p, kdf.salt
    )
    .into_bytes()
}

fn fingerprint_with(key: &DerivedKey, plaintext: &[u8]) -> String {
    hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, &key[32..]), plaintext)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn cipher(key: &DerivedKey) -> Result<LessSafeKey, String> {
    UnboundKey::new(&AES_256_GCM, &key[..32])
        .map(LessSafeKey::new)
        .map_err(|_| "Schlüssel ungültig.".to_string())
}

pub fn fresh_kdf() -> KdfParams {
    let salt: [u8; SALT_LEN] = rand::random();
    KdfParams {
        alg: "argon2id".into(),
        m: MEMORY_KIB,
        t: ITERATIONS,
        p: PARALLELISM,
        salt: STANDARD.encode(salt),
    }
}

pub fn kdf_for_salt(salt: Option<&str>) -> KdfParams {
    match salt {
        Some(salt) if !salt.is_empty() => {
            let kdf = KdfParams {
                salt: salt.to_string(),
                ..fresh_kdf()
            };
            if validate(&kdf).is_ok() {
                kdf
            } else {
                fresh_kdf()
            }
        }
        _ => fresh_kdf(),
    }
}

pub fn seal(passphrase: &str, plaintext: &str, kdf: KdfParams) -> Result<Sealed, String> {
    if passphrase.is_empty() {
        return Err("Keine Sync-Passphrase hinterlegt.".into());
    }
    let key = derive(passphrase, &kdf)?;
    let nonce: [u8; NONCE_LEN] = rand::random();
    let aad = associated(&kdf);
    let mut data = plaintext.as_bytes().to_vec();
    cipher(&key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(&aad),
            &mut data,
        )
        .map_err(|_| "Verschlüsselung fehlgeschlagen.".to_string())?;
    let fingerprint = fingerprint_with(&key, plaintext.as_bytes());
    let salt = kdf.salt.clone();
    let envelope = Envelope {
        v: 1,
        kdf,
        cipher: "aes-256-gcm".into(),
        nonce: STANDARD.encode(nonce),
        data: STANDARD.encode(data),
    };
    Ok(Sealed {
        envelope: serde_json::to_string(&envelope).map_err(|e| e.to_string())?,
        fingerprint,
        salt,
    })
}

pub fn open(passphrase: &str, envelope: &str) -> Result<String, String> {
    if envelope.len() > MAX_ENVELOPE_BYTES {
        return Err("Verschlüsselte Sync-Daten sind zu groß.".into());
    }
    if passphrase.is_empty() {
        return Err(
            "Die Sync-Daten sind verschlüsselt. Bitte zuerst die Sync-Passphrase hinterlegen."
                .into(),
        );
    }
    let envelope: Envelope = serde_json::from_str(envelope)
        .map_err(|_| "Verschlüsselte Sync-Daten sind beschädigt.".to_string())?;
    if envelope.v != 1 || envelope.cipher != "aes-256-gcm" {
        return Err("Nicht unterstütztes Verschlüsselungsformat.".into());
    }
    let key = derive(passphrase, &envelope.kdf)?;
    let nonce: [u8; NONCE_LEN] = STANDARD
        .decode(&envelope.nonce)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "Verschlüsselte Sync-Daten sind beschädigt.".to_string())?;
    let mut data = STANDARD
        .decode(&envelope.data)
        .map_err(|_| "Verschlüsselte Sync-Daten sind beschädigt.".to_string())?;
    let aad = associated(&envelope.kdf);
    let plain = cipher(&key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(&aad),
            &mut data,
        )
        .map_err(|_| {
            "Entschlüsselung fehlgeschlagen: Passphrase falsch oder Daten manipuliert.".to_string()
        })?
        .to_vec();
    String::from_utf8(plain).map_err(|_| "Entschlüsselte Sync-Daten sind ungültig.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quick_kdf() -> KdfParams {
        KdfParams {
            m: 19 * 1024,
            t: 1,
            ..fresh_kdf()
        }
    }

    #[test]
    fn round_trip_restores_plaintext() {
        let sealed = seal("korrekt pferd batterie", "{\"a\":1}", quick_kdf()).unwrap();
        assert!(!sealed.envelope.contains("\"a\":1"));
        assert_eq!(
            open("korrekt pferd batterie", &sealed.envelope).unwrap(),
            "{\"a\":1}"
        );
    }

    #[test]
    fn wrong_passphrase_fails() {
        let sealed = seal("richtig", "geheim", quick_kdf()).unwrap();
        let error = open("falsch", &sealed.envelope).unwrap_err();
        assert!(error.contains("Passphrase falsch"));
    }

    #[test]
    fn nonce_is_random_and_fingerprint_stable_for_same_salt() {
        let kdf = quick_kdf();
        let first = seal("pw", "inhalt", kdf.clone()).unwrap();
        let second = seal("pw", "inhalt", kdf.clone()).unwrap();
        assert_ne!(first.envelope, second.envelope);
        assert_eq!(first.fingerprint, second.fingerprint);
        let other = seal("pw", "anders", kdf).unwrap();
        assert_ne!(first.fingerprint, other.fingerprint);
    }

    #[test]
    fn tampered_header_is_rejected() {
        let sealed = seal("pw", "inhalt", quick_kdf()).unwrap();
        let mut envelope: Envelope = serde_json::from_str(&sealed.envelope).unwrap();
        envelope.kdf.t = 2;
        let error = open("pw", &serde_json::to_string(&envelope).unwrap()).unwrap_err();
        assert!(error.contains("Entschlüsselung fehlgeschlagen"));
    }

    #[test]
    fn hostile_kdf_parameters_are_rejected() {
        let sealed = seal("pw", "inhalt", quick_kdf()).unwrap();
        let mut envelope: Envelope = serde_json::from_str(&sealed.envelope).unwrap();
        envelope.kdf.m = 64 * 1024 * 1024;
        assert!(open("pw", &serde_json::to_string(&envelope).unwrap())
            .unwrap_err()
            .contains("Argon2-Parameter"));
    }

    #[test]
    fn production_parameters_cache_the_derived_key() {
        let payload = "x".repeat(4_700_000);
        let kdf = fresh_kdf();
        let started = std::time::Instant::now();
        let first = seal("perf-passphrase", &payload, kdf.clone()).unwrap();
        let derive_and_seal = started.elapsed();
        let mut cached = Vec::new();
        for _ in 0..5 {
            let started = std::time::Instant::now();
            let sealed = seal("perf-passphrase", &payload, kdf.clone()).unwrap();
            assert_eq!(
                open("perf-passphrase", &sealed.envelope).unwrap().len(),
                payload.len()
            );
            cached.push(started.elapsed());
        }
        cached.sort();
        println!(
            "performance sync-crypto: {{\"payloadBytes\":{},\"envelopeBytes\":{},\"kdfAndSealMs\":{},\"cachedSealOpenMedianMs\":{},\"cachedSealOpenMaxMs\":{}}}",
            payload.len(),
            first.envelope.len(),
            derive_and_seal.as_millis(),
            cached[2].as_millis(),
            cached[4].as_millis()
        );
        assert!(first.envelope.len() < payload.len() * 4 / 3 + 1024);
        assert!(cached[2] < derive_and_seal);
    }

    #[test]
    fn default_parameters_follow_rfc_9106() {
        let kdf = fresh_kdf();
        assert_eq!((kdf.m, kdf.t, kdf.p), (65536, 3, 1));
        assert_eq!(STANDARD.decode(kdf.salt).unwrap().len(), 16);
    }
}
