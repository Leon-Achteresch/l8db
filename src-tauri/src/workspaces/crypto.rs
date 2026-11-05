use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    aead, digest, hmac,
    rand::{SecureRandom, SystemRandom},
};
use std::path::Path;

pub fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Zufallsquelle nicht verfügbar")?;
    Ok(bytes)
}

pub fn id() -> Result<String, String> {
    Ok(URL_SAFE_NO_PAD.encode(random::<24>()?))
}

pub fn hash_token(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, token.as_bytes()))
}

pub fn password_hash(password: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
    if password.len() < 12 || password.len() > 1024 {
        return Err("Passwort muss zwischen 12 und 1024 Zeichen lang sein.".into());
    }
    let params = Params::new(19_456, 2, 1, Some(32)).map_err(|_| "Passwortparameter ungültig")?;
    let mut hash = vec![0; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut hash)
        .map_err(|_| "Passwort konnte nicht geschützt werden")?;
    Ok(hash)
}

pub fn password_matches(password: &str, salt: &[u8], expected: &[u8]) -> bool {
    let Ok(actual) = password_hash(password, salt) else {
        return false;
    };
    let key = hmac::Key::new(hmac::HMAC_SHA256, b"l8db-workspace-password-comparison");
    let tag = hmac::sign(&key, expected);
    hmac::verify(&key, &actual, tag.as_ref()).is_ok()
}

pub fn master_key(root: &Path) -> Result<[u8; 32], String> {
    let path = root.join("credentials.key");
    match std::fs::read(&path) {
        Ok(bytes) => bytes
            .try_into()
            .map_err(|_| "Workspace-Schlüssel beschädigt".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            use std::io::Write;
            let key = random::<32>()?;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            let mut file = options
                .open(path)
                .map_err(|_| "Workspace-Schlüssel konnte nicht angelegt werden")?;
            file.write_all(&key)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Workspace-Schlüssel konnte nicht gespeichert werden")?;
            Ok(key)
        }
        Err(_) => Err("Workspace-Schlüssel konnte nicht gelesen werden".into()),
    }
}

pub fn seal(key: &[u8; 32], context: &str, text: &str) -> Result<String, String> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key)
            .map_err(|_| "Workspace-Schlüssel ungültig")?,
    );
    let nonce = random::<12>()?;
    let mut value = text.as_bytes().to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(context.as_bytes()),
        &mut value,
    )
    .map_err(|_| "Zugang konnte nicht verschlüsselt werden")?;
    let mut output = nonce.to_vec();
    output.extend(value);
    Ok(URL_SAFE_NO_PAD.encode(output))
}

pub fn open(key: &[u8; 32], context: &str, text: &str) -> Result<String, String> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key)
            .map_err(|_| "Workspace-Schlüssel ungültig")?,
    );
    let mut bytes = URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| "Gespeicherter Zugang beschädigt")?;
    if bytes.len() < 28 {
        return Err("Gespeicherter Zugang beschädigt".into());
    }
    let nonce: [u8; 12] = bytes[..12]
        .try_into()
        .map_err(|_| "Gespeicherter Zugang beschädigt")?;
    let value = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(context.as_bytes()),
            &mut bytes[12..],
        )
        .map_err(|_| "Zugang konnte nicht entschlüsselt werden")?;
    String::from_utf8(value.to_vec()).map_err(|_| "Gespeicherter Zugang beschädigt".into())
}
