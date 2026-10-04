use ring::{aead, digest, hkdf, hmac, rand::SecureRandom};
use zeroize::Zeroizing;

pub const CHUNK: usize = 1 << 20;
const TAG: usize = 16;
const MAGIC: &[u8; 8] = b"L8DBENC1";
pub const HEADER_LEN: usize = 8 + 16 + 32 + 7 + 4;

pub type Secret = Zeroizing<[u8; 32]>;

struct Len(usize);

impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

pub fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut out = [0u8; N];
    ring::rand::SystemRandom::new()
        .fill(&mut out)
        .map_err(|_| "Sicherer Zufallsgenerator nicht verfügbar".to_string())?;
    Ok(out)
}

pub fn derive(secret: &[u8], salt: &[u8], label: &str) -> Result<Secret, String> {
    let mut out = Zeroizing::new([0u8; 32]);
    hkdf::Salt::new(hkdf::HKDF_SHA256, salt)
        .extract(secret)
        .expand(&[label.as_bytes()], Len(32))
        .and_then(|okm| okm.fill(out.as_mut()))
        .map_err(|_| "Schlüsselableitung fehlgeschlagen".to_string())?;
    Ok(out)
}

pub fn mac(key: &[u8], data: &[u8]) -> [u8; 32] {
    let tag = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), data);
    let mut out = [0u8; 32];
    out.copy_from_slice(tag.as_ref());
    out
}

pub fn mac_matches(key: &[u8], data: &[u8], expected: &[u8]) -> bool {
    hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, key), data, expected).is_ok()
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(digest::digest(&digest::SHA256, data).as_ref());
    out
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

pub fn unhex(text: &str) -> Result<Vec<u8>, String> {
    if !text.len().is_multiple_of(2) {
        return Err("Ungültiger Hexwert".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(text.get(index..index + 2).unwrap_or("x"), 16)
                .map_err(|_| "Ungültiger Hexwert".to_string())
        })
        .collect()
}

fn sealing_key(root: &[u8], salt: &[u8]) -> Result<aead::LessSafeKey, String> {
    let key = derive(root, salt, "l8db-vault-file-v1")?;
    aead::UnboundKey::new(&aead::AES_256_GCM, key.as_ref())
        .map(aead::LessSafeKey::new)
        .map_err(|_| "AES-Schlüssel ungültig".to_string())
}

fn nonce(prefix: &[u8; 7], counter: u32, last: bool) -> aead::Nonce {
    let mut value = [0u8; 12];
    value[..7].copy_from_slice(prefix);
    value[7..11].copy_from_slice(&counter.to_be_bytes());
    value[11] = u8::from(last);
    aead::Nonce::assume_unique_for_key(value)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Digests {
    pub plain_sha256: String,
    pub cipher_sha256: String,
    pub plain_bytes: u64,
    pub cipher_bytes: u64,
    pub chunks: u32,
}

struct Totals {
    plain: digest::Context,
    cipher: digest::Context,
    plain_bytes: u64,
    cipher_bytes: u64,
}

impl Totals {
    fn new() -> Self {
        Self {
            plain: digest::Context::new(&digest::SHA256),
            cipher: digest::Context::new(&digest::SHA256),
            plain_bytes: 0,
            cipher_bytes: 0,
        }
    }

    fn finish(self, chunks: u32) -> Digests {
        Digests {
            plain_sha256: hex(self.plain.finish().as_ref()),
            cipher_sha256: hex(self.cipher.finish().as_ref()),
            plain_bytes: self.plain_bytes,
            cipher_bytes: self.cipher_bytes,
            chunks,
        }
    }
}

pub struct Encryptor {
    key: aead::LessSafeKey,
    header: Vec<u8>,
    prefix: [u8; 7],
    counter: u32,
    pending: Vec<u8>,
    totals: Totals,
}

impl Encryptor {
    pub fn new(root: &[u8], key_id: &[u8; 16]) -> Result<(Self, Vec<u8>), String> {
        let salt: [u8; 32] = random()?;
        let prefix: [u8; 7] = random()?;
        let mut header = Vec::with_capacity(HEADER_LEN);
        header.extend_from_slice(MAGIC);
        header.extend_from_slice(key_id);
        header.extend_from_slice(&salt);
        header.extend_from_slice(&prefix);
        header.extend_from_slice(&(CHUNK as u32).to_be_bytes());
        let mut totals = Totals::new();
        totals.cipher.update(&header);
        totals.cipher_bytes = header.len() as u64;
        Ok((
            Self {
                key: sealing_key(root, &salt)?,
                header: header.clone(),
                prefix,
                counter: 0,
                pending: Vec::with_capacity(CHUNK * 2),
                totals,
            },
            header,
        ))
    }

    fn seal(&mut self, size: usize, last: bool, out: &mut Vec<u8>) -> Result<(), String> {
        let mut block: Vec<u8> = self.pending.drain(..size).collect();
        self.key
            .seal_in_place_append_tag(
                nonce(&self.prefix, self.counter, last),
                aead::Aad::from(&self.header),
                &mut block,
            )
            .map_err(|_| "Verschlüsselung fehlgeschlagen".to_string())?;
        self.counter = self
            .counter
            .checked_add(1)
            .ok_or("Datei ist zu groß für den Tresor")?;
        self.totals.cipher.update(&block);
        self.totals.cipher_bytes += block.len() as u64;
        out.extend_from_slice(&block);
        Ok(())
    }

    pub fn update(&mut self, data: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
        self.totals.plain.update(data);
        self.totals.plain_bytes += data.len() as u64;
        self.pending.extend_from_slice(data);
        while self.pending.len() > CHUNK {
            self.seal(CHUNK, false, out)?;
        }
        Ok(())
    }

    pub fn finish(mut self, out: &mut Vec<u8>) -> Result<Digests, String> {
        let size = self.pending.len();
        self.seal(size, true, out)?;
        Ok(self.totals.finish(self.counter))
    }
}

pub fn key_id_of(header: &[u8]) -> Result<[u8; 16], String> {
    if header.len() < HEADER_LEN || &header[..8] != MAGIC {
        return Err("Keine l8db-Tresordatei oder unbekanntes Format".into());
    }
    let mut id = [0u8; 16];
    id.copy_from_slice(&header[8..24]);
    Ok(id)
}

pub struct Decryptor {
    key: aead::LessSafeKey,
    header: Vec<u8>,
    prefix: [u8; 7],
    counter: u32,
    pending: Vec<u8>,
    totals: Totals,
}

impl Decryptor {
    pub fn new(root: &[u8], key_id: &[u8; 16], header: &[u8]) -> Result<Self, String> {
        if key_id_of(header)? != *key_id {
            return Err("Die Datei wurde mit einem anderen Tresor-Schlüssel verschlüsselt.".into());
        }
        let chunk = u32::from_be_bytes([header[63], header[64], header[65], header[66]]);
        if chunk as usize != CHUNK {
            return Err("Nicht unterstützte Blockgröße in der Tresordatei".into());
        }
        let mut prefix = [0u8; 7];
        prefix.copy_from_slice(&header[56..63]);
        let mut totals = Totals::new();
        totals.cipher.update(&header[..HEADER_LEN]);
        totals.cipher_bytes = HEADER_LEN as u64;
        Ok(Self {
            key: sealing_key(root, &header[24..56])?,
            header: header[..HEADER_LEN].to_vec(),
            prefix,
            counter: 0,
            pending: Vec::with_capacity((CHUNK + TAG) * 2),
            totals,
        })
    }

    fn open(&mut self, size: usize, last: bool, out: &mut Vec<u8>) -> Result<(), String> {
        let mut block: Vec<u8> = self.pending.drain(..size).collect();
        self.totals.cipher.update(&block);
        self.totals.cipher_bytes += block.len() as u64;
        let plain = self
            .key
            .open_in_place(
                nonce(&self.prefix, self.counter, last),
                aead::Aad::from(&self.header),
                &mut block,
            )
            .map_err(|_| {
                "Integritätsprüfung fehlgeschlagen: Die Tresordatei wurde verändert, gekürzt oder beschädigt."
                    .to_string()
            })?;
        self.totals.plain.update(plain);
        self.totals.plain_bytes += plain.len() as u64;
        out.extend_from_slice(plain);
        self.counter = self
            .counter
            .checked_add(1)
            .ok_or("Tresordatei enthält zu viele Blöcke")?;
        Ok(())
    }

    pub fn update(&mut self, data: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
        self.pending.extend_from_slice(data);
        while self.pending.len() > CHUNK + TAG {
            self.open(CHUNK + TAG, false, out)?;
        }
        Ok(())
    }

    pub fn finish(mut self, out: &mut Vec<u8>) -> Result<Digests, String> {
        if self.pending.len() < TAG {
            return Err(
                "Integritätsprüfung fehlgeschlagen: Die Tresordatei ist unvollständig.".into(),
            );
        }
        let size = self.pending.len();
        self.open(size, true, out)?;
        Ok(self.totals.finish(self.counter))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seal_all(root: &[u8], id: &[u8; 16], data: &[u8], step: usize) -> (Vec<u8>, Digests) {
        let (mut enc, header) = Encryptor::new(root, id).unwrap();
        let mut out = header;
        for part in data.chunks(step.max(1)) {
            enc.update(part, &mut out).unwrap();
        }
        let digests = enc.finish(&mut out).unwrap();
        (out, digests)
    }

    fn open_all(root: &[u8], id: &[u8; 16], file: &[u8], step: usize) -> Result<Vec<u8>, String> {
        let mut dec = Decryptor::new(root, id, &file[..HEADER_LEN.min(file.len())])?;
        let mut out = Vec::new();
        for part in file[HEADER_LEN..].chunks(step.max(1)) {
            dec.update(part, &mut out)?;
        }
        dec.finish(&mut out)?;
        Ok(out)
    }

    #[test]
    fn roundtrip_across_chunk_boundaries() {
        let root = [7u8; 32];
        let id = [1u8; 16];
        for size in [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 2 * CHUNK + 17] {
            let data: Vec<u8> = (0..size).map(|index| (index % 251) as u8).collect();
            let (file, digests) = seal_all(&root, &id, &data, 300_007);
            assert_eq!(digests.plain_bytes, size as u64);
            assert_eq!(digests.cipher_bytes, file.len() as u64);
            assert_eq!(digests.plain_sha256, hex(&sha256(&data)));
            assert_eq!(digests.cipher_sha256, hex(&sha256(&file)));
            assert_eq!(open_all(&root, &id, &file, 65_537).unwrap(), data);
        }
    }

    #[test]
    fn tampering_truncation_and_reordering_are_rejected() {
        let root = [9u8; 32];
        let id = [2u8; 16];
        let data: Vec<u8> = (0..(2 * CHUNK + 10))
            .map(|index| (index % 13) as u8)
            .collect();
        let (file, _) = seal_all(&root, &id, &data, CHUNK);
        let mut flipped = file.clone();
        flipped[HEADER_LEN + 5] ^= 1;
        assert!(open_all(&root, &id, &flipped, CHUNK).is_err());
        let mut header = file.clone();
        header[30] ^= 1;
        assert!(open_all(&root, &id, &header, CHUNK).is_err());
        let boundary = HEADER_LEN + 2 * (CHUNK + TAG);
        assert!(open_all(&root, &id, &file[..boundary], CHUNK).is_err());
        assert!(open_all(&root, &id, &file[..file.len() - 1], CHUNK).is_err());
        let mut swapped = file[..HEADER_LEN].to_vec();
        swapped.extend_from_slice(&file[HEADER_LEN + CHUNK + TAG..boundary]);
        swapped.extend_from_slice(&file[HEADER_LEN..HEADER_LEN + CHUNK + TAG]);
        swapped.extend_from_slice(&file[boundary..]);
        assert!(open_all(&root, &id, &swapped, CHUNK).is_err());
        assert!(open_all(&[8u8; 32], &id, &file, CHUNK).is_err());
        let error = open_all(&root, &[3u8; 16], &file, CHUNK).unwrap_err();
        assert!(error.contains("anderen Tresor-Schlüssel"));
    }

    #[test]
    fn files_use_fresh_salt_and_keys() {
        let root = [4u8; 32];
        let id = [5u8; 16];
        let (a, _) = seal_all(&root, &id, b"same content", 4);
        let (b, _) = seal_all(&root, &id, b"same content", 4);
        assert_ne!(a, b);
        assert_ne!(
            derive(&root, b"a", "x").unwrap(),
            derive(&root, b"b", "x").unwrap()
        );
        assert_ne!(
            derive(&root, b"a", "x").unwrap(),
            derive(&root, b"a", "y").unwrap()
        );
    }

    #[test]
    fn mac_detects_changes() {
        let tag = mac(b"key", b"payload");
        assert!(mac_matches(b"key", b"payload", &tag));
        assert!(!mac_matches(b"key", b"payloaD", &tag));
        assert!(!mac_matches(b"kez", b"payload", &tag));
        assert_eq!(unhex(&hex(&tag)).unwrap(), tag.to_vec());
    }
}
