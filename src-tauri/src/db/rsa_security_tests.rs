use super::*;
use russh::keys::signature::{Signer as SshSigner, Verifier};
use russh::keys::ssh_key::{private::KeypairData, HashAlg};

fn verify_with_ring(
    key: &openssl::rsa::Rsa<Private>,
    message: &[u8],
    signature: &[u8],
    hash: HashAlg,
) {
    let algorithm = match hash {
        HashAlg::Sha256 => &ring::signature::RSA_PKCS1_2048_8192_SHA256,
        HashAlg::Sha512 => &ring::signature::RSA_PKCS1_2048_8192_SHA512,
        _ => panic!("unexpected hash algorithm"),
    };
    ring::signature::UnparsedPublicKey::new(algorithm, key.public_key_to_der_pkcs1().unwrap())
        .verify(message, signature)
        .unwrap();
}

#[test]
fn rsa_security_ssh_formats_signatures_and_export_remain_interoperable() {
    let native = tests::test_key().rsa().unwrap();
    let pkcs1 = String::from_utf8(native.private_key_to_pem().unwrap()).unwrap();
    let pkcs8 = tests::test_key_pem();
    for pem in [pkcs1, pkcs8] {
        let key = russh::keys::decode_secret_key(&pem, None).unwrap();
        let KeypairData::Rsa(pair) = key.key_data() else {
            panic!("RSA key expected")
        };
        for hash in [HashAlg::Sha256, HashAlg::Sha512] {
            let signature = (pair, Some(hash)).try_sign(b"l8db-ssh-auth").unwrap();
            verify_with_ring(&native, b"l8db-ssh-auth", signature.as_bytes(), hash);
            pair.public().verify(b"l8db-ssh-auth", &signature).unwrap();
            assert!(pair.public().verify(b"tampered", &signature).is_err());
        }
        let legacy = (pair, None).try_sign(b"legacy-peer").unwrap();
        pair.public().verify(b"legacy-peer", &legacy).unwrap();
        let signature = key.sign("l8db", HashAlg::Sha512, b"message").unwrap();
        key.public_key()
            .verify("l8db", b"message", &signature)
            .unwrap();
        assert!(key
            .public_key()
            .verify("other", b"message", &signature)
            .is_err());
        let mut exported = Vec::new();
        russh::keys::encode_pkcs8_pem(&key, &mut exported).unwrap();
        assert!(PKey::private_key_from_pem(&exported)
            .unwrap()
            .public_eq(tests::test_key()));
        let mut encrypted = Vec::new();
        russh::keys::encode_pkcs8_pem_encrypted(&key, b"test-password", 2048, &mut encrypted)
            .unwrap();
        let restored = russh::keys::decode_secret_key(
            std::str::from_utf8(&encrypted).unwrap(),
            Some("test-password"),
        )
        .unwrap();
        assert_eq!(restored.public_key(), key.public_key());
        assert!(russh::keys::decode_secret_key(
            std::str::from_utf8(&encrypted).unwrap(),
            Some("wrong")
        )
        .is_err());
    }
}

#[test]
#[ignore]
fn rsa_security_perf_bounds_cloud_and_ssh_signing() {
    for bits in [2048, 4096] {
        let native = openssl::rsa::Rsa::generate(bits).unwrap();
        let cloud = PKey::from_rsa(native.clone()).unwrap();
        let pem = String::from_utf8(cloud.private_key_to_pem_pkcs8().unwrap()).unwrap();
        let start = Instant::now();
        let ssh = russh::keys::decode_secret_key(&pem, None).unwrap();
        let cold_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert!(cold_ms < 1000.0, "{bits} cold import budget exceeded");
        println!(
            "RSA {bits}: cold import={cold_ms:.2}ms; at most one validated native key per keypair"
        );
        let KeypairData::Rsa(pair) = ssh.key_data() else {
            panic!("RSA key expected")
        };
        for operation in ["jwt", "ssh"] {
            let mut samples = Vec::new();
            for _ in 0..21 {
                let start = Instant::now();
                match operation {
                    "jwt" => {
                        let jwt = sign_rs256(
                            &cloud,
                            &serde_json::json!({"sub":"service-account","exp":3600}),
                        )
                        .unwrap();
                        assert!(jwt.len() < 1024);
                    }
                    _ => {
                        let signature = (pair, Some(HashAlg::Sha512))
                            .try_sign(b"ssh authentication")
                            .unwrap();
                        assert_eq!(signature.as_bytes().len(), bits as usize / 8);
                    }
                }
                samples.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            samples.sort_by(f64::total_cmp);
            println!("RSA {bits} {operation}: median={:.2}ms p95={:.2}ms; <=1024B output, 0 requests/background tasks", samples[10], samples[19]);
            assert!(
                samples[10] < 100.0,
                "{bits} {operation} median budget exceeded"
            );
            assert!(
                samples[19] < 250.0,
                "{bits} {operation} p95 budget exceeded"
            );
        }
        let start = Instant::now();
        for _ in 0..5 {
            assert!(load_rsa_key(&pem, None).unwrap().public_eq(&cloud));
        }
        assert!(start.elapsed() < Duration::from_secs(3));
        let mut malformed = pem.into_bytes();
        malformed[40] = b'!';
        assert!(load_rsa_key(std::str::from_utf8(&malformed).unwrap(), None).is_err());
    }
}

#[test]
fn rsa_security_concurrent_first_use_and_invalid_components() {
    let native = tests::test_key().rsa().unwrap();
    let imported = ssh_key_pair(&native);
    let fresh = russh::keys::ssh_key::private::RsaKeypair::new(
        imported.public().clone(),
        imported.private().clone(),
    )
    .unwrap();
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let pair = &fresh;
            let native = &native;
            scope.spawn(move || {
                let signature = (pair, Some(HashAlg::Sha256))
                    .try_sign(b"concurrent")
                    .unwrap();
                verify_with_ring(native, b"concurrent", signature.as_bytes(), HashAlg::Sha256);
            });
        }
    });
    let invalid = russh::keys::ssh_key::private::RsaPrivateKey::new(
        imported.private().d().clone(),
        imported.private().p().clone(),
        imported.private().p().clone(),
        imported.private().q().clone(),
    )
    .unwrap();
    let invalid =
        russh::keys::ssh_key::private::RsaKeypair::new(imported.public().clone(), invalid).unwrap();
    assert!((&invalid, Some(HashAlg::Sha256))
        .try_sign(b"reject invalid CRT")
        .is_err());
    assert!((&invalid, Some(HashAlg::Sha256))
        .try_sign(b"cached invalid state")
        .is_err());
}

fn ssh_key_pair(native: &openssl::rsa::Rsa<Private>) -> russh::keys::ssh_key::private::RsaKeypair {
    native.try_into().unwrap()
}

#[test]
fn rsa_security_native_library_meets_security_release_floor() {
    let version = openssl::version::version();
    let version = version
        .strip_prefix("OpenSSL ")
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap();
    let parts = version
        .split('.')
        .map(|part| part.parse::<u32>().unwrap())
        .collect::<Vec<_>>();
    assert!(parts.as_slice() >= [4, 0, 3].as_slice());
}
