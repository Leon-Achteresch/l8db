use blowfish::cipher::{Array, BlockCipherDecrypt, BlockCipherEncrypt, KeyInit};
use blowfish::Blowfish;
use sha1::{Digest, Sha1};

const NAVICAT11_SEED: &[u8] = b"3DC5CA39";
const MAX_CIPHER_HEX: usize = 4096;

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    let value = value.trim();
    if value.is_empty() || value.len() % 2 != 0 || value.len() > MAX_CIPHER_HEX {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(value.get(index..index + 2)?, 16).ok())
        .collect()
}

fn xor8(left: &[u8; 8], right: &[u8]) -> [u8; 8] {
    let mut out = [0u8; 8];
    for index in 0..8 {
        out[index] = left[index] ^ right[index];
    }
    out
}

fn navicat11_cipher() -> Blowfish {
    let key = Sha1::digest(NAVICAT11_SEED);
    Blowfish::new_from_slice(&key).expect("Blowfish akzeptiert 20-Byte-Schlüssel")
}

fn encrypt_block(cipher: &Blowfish, block: [u8; 8]) -> [u8; 8] {
    let mut buffer = Array::from(block);
    cipher.encrypt_block(&mut buffer);
    buffer.into()
}

fn decrypt_block(cipher: &Blowfish, block: [u8; 8]) -> [u8; 8] {
    let mut buffer = Array::from(block);
    cipher.decrypt_block(&mut buffer);
    buffer.into()
}

pub fn decrypt_navicat11(value: &str) -> Option<String> {
    let bytes = decode_hex(value)?;
    let cipher = navicat11_cipher();
    let mut chain = encrypt_block(&cipher, [0xFF; 8]);
    let mut plain = Vec::with_capacity(bytes.len());
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let block: [u8; 8] = chunk.try_into().ok()?;
        plain.extend_from_slice(&xor8(&decrypt_block(&cipher, block), &chain));
        chain = xor8(&chain, &block);
    }
    let rest = chunks.remainder();
    if !rest.is_empty() {
        let stream = encrypt_block(&cipher, chain);
        plain.extend(
            rest.iter()
                .zip(stream.iter())
                .map(|(left, right)| left ^ right),
        );
    }
    String::from_utf8(plain).ok()
}

#[tauri::command]
pub fn decrypt_navicat_legacy_passwords(values: Vec<String>) -> Vec<Option<String>> {
    values
        .iter()
        .map(|value| decrypt_navicat11(value))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decrypts_navicat11_vectors() {
        assert_eq!(
            decrypt_navicat11("F7CD9A953A6DFF06206844").as_deref(),
            Some("legacyPw123")
        );
        assert_eq!(decrypt_navicat11("575F213DE2").as_deref(), Some("short"));
        assert_eq!(
            decrypt_navicat11("420875526a0b2512").as_deref(),
            Some("exactly8")
        );
    }

    #[test]
    fn rejects_malformed_navicat11_input() {
        assert_eq!(decrypt_navicat11(""), None);
        assert_eq!(decrypt_navicat11("ABC"), None);
        assert_eq!(decrypt_navicat11("ZZZZ"), None);
        assert_eq!(decrypt_navicat11(&"A".repeat(MAX_CIPHER_HEX + 2)), None);
        assert_eq!(
            decrypt_navicat_legacy_passwords(vec!["575F213DE2".into(), "XY".into()]),
            vec![Some("short".to_string()), None]
        );
    }
}
