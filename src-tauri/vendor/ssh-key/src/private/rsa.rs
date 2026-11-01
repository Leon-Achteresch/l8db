//! Rivest–Shamir–Adleman (RSA) private keys.

use crate::{Error, Mpint, Result, public::RsaPublicKey};
use core::fmt::{self, Debug};
use ctutils::{Choice, CtEq};
use encoding::{CheckedSum, Decode, Encode, Reader, Writer};
use zeroize::Zeroize;

#[cfg(feature = "rsa")]
use {
    openssl::{
        bn::{BigNum, BigNumContext},
        pkey::{Private, Public},
        rsa::Rsa,
    },
    rand_core::CryptoRng,
};

/// RSA private key.
#[derive(Clone)]
pub struct RsaPrivateKey {
    /// RSA private exponent.
    d: Mpint,

    /// CRT coefficient: `(inverse of q) mod p`.
    iqmp: Mpint,

    /// First prime factor of `n`.
    p: Mpint,

    /// Second prime factor of `n`.
    q: Mpint,
}

impl RsaPrivateKey {
    /// Create a new RSA private key with the following components:
    ///
    /// - `d`: RSA private exponent.
    /// - `iqmp`: CRT coefficient: `(inverse of q) mod p`.
    /// - `p`: First prime factor of `n`.
    /// - `q`: Second prime factor of `n`.
    ///
    /// # Errors
    /// Returns [`Error::FormatEncoding`] if any of the provided values are negative.
    pub fn new(d: Mpint, iqmp: Mpint, p: Mpint, q: Mpint) -> Result<Self> {
        if d.is_positive() && iqmp.is_positive() && p.is_positive() && q.is_positive() {
            Ok(Self { d, iqmp, p, q })
        } else {
            Err(Error::FormatEncoding)
        }
    }

    /// RSA private exponent.
    #[must_use]
    pub fn d(&self) -> &Mpint {
        &self.d
    }

    /// CRT coefficient: `(inverse of q) mod p`.
    #[must_use]
    pub fn iqmp(&self) -> &Mpint {
        &self.iqmp
    }

    /// First prime factor of `n`.
    #[must_use]
    pub fn p(&self) -> &Mpint {
        &self.p
    }

    /// Second prime factor of `n`.
    #[must_use]
    pub fn q(&self) -> &Mpint {
        &self.q
    }
}

impl CtEq for RsaPrivateKey {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.d.ct_eq(&other.d)
            & self.iqmp.ct_eq(&self.iqmp)
            & self.p.ct_eq(&other.p)
            & self.q.ct_eq(&other.q)
    }
}

impl Debug for RsaPrivateKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RsaPrivateKey").finish_non_exhaustive()
    }
}

impl Drop for RsaPrivateKey {
    fn drop(&mut self) {
        self.d.zeroize();
        self.iqmp.zeroize();
        self.p.zeroize();
        self.q.zeroize();
    }
}

impl Decode for RsaPrivateKey {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let d = Mpint::decode(reader)?;
        let iqmp = Mpint::decode(reader)?;
        let p = Mpint::decode(reader)?;
        let q = Mpint::decode(reader)?;
        Self::new(d, iqmp, p, q)
    }
}

impl Encode for RsaPrivateKey {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            self.d.encoded_len()?,
            self.iqmp.encoded_len()?,
            self.p.encoded_len()?,
            self.q.encoded_len()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.d.encode(writer)?;
        self.iqmp.encode(writer)?;
        self.p.encode(writer)?;
        self.q.encode(writer)?;
        Ok(())
    }
}

impl Eq for RsaPrivateKey {}
impl PartialEq for RsaPrivateKey {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

/// RSA private/public keypair.
#[derive(Clone)]
pub struct RsaKeypair {
    /// Public key.
    public: RsaPublicKey,

    /// Private key.
    private: RsaPrivateKey,

    #[cfg(feature = "rsa")]
    native: std::sync::OnceLock<Option<Rsa<Private>>>,
}

impl RsaKeypair {
    /// Generate a random RSA keypair of the given size.
    #[cfg(feature = "rsa")]
    #[expect(clippy::missing_errors_doc, reason = "TODO")]
    pub fn random<R: CryptoRng + ?Sized>(_rng: &mut R, bit_size: usize) -> Result<Self> {
        Rsa::generate(bit_size.try_into().map_err(|_| Error::Crypto)?)?.try_into()
    }

    /// Create a new keypair from the given `public` and `private` key components.
    ///
    /// # Errors
    /// Returns [`Error::Crypto`] if the `public` key does not match the `private` key (TODO).
    pub fn new(public: RsaPublicKey, private: RsaPrivateKey) -> Result<Self> {
        // TODO(tarcieri): perform validation that the public and private components match?
        Ok(Self {
            public,
            private,
            #[cfg(feature = "rsa")]
            native: std::sync::OnceLock::new(),
        })
    }

    /// Get the size of the RSA modulus in bits.
    #[must_use]
    pub fn key_size(&self) -> u32 {
        self.public.key_size()
    }

    /// Get the public component of the keypair.
    #[must_use]
    pub fn public(&self) -> &RsaPublicKey {
        &self.public
    }

    /// Get the private component of the keypair.
    #[must_use]
    pub fn private(&self) -> &RsaPrivateKey {
        &self.private
    }
}

impl CtEq for RsaKeypair {
    fn ct_eq(&self, other: &Self) -> Choice {
        Choice::from(u8::from(self.public == other.public)) & self.private.ct_eq(&other.private)
    }
}

impl Debug for RsaKeypair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RsaKeypair")
            .field("public", &self.public)
            .finish_non_exhaustive()
    }
}

impl Decode for RsaKeypair {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let n = Mpint::decode(reader)?;
        let e = Mpint::decode(reader)?;
        let public = RsaPublicKey::new(e, n)?;
        let private = RsaPrivateKey::decode(reader)?;
        Self::new(public, private)
    }
}

impl Encode for RsaKeypair {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            self.public.n().encoded_len()?,
            self.public.e().encoded_len()?,
            self.private.encoded_len()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.public.n().encode(writer)?;
        self.public.e().encode(writer)?;
        self.private.encode(writer)
    }
}

impl Eq for RsaKeypair {}
impl PartialEq for RsaKeypair {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

impl From<RsaKeypair> for RsaPublicKey {
    fn from(keypair: RsaKeypair) -> RsaPublicKey {
        keypair.public
    }
}

impl From<&RsaKeypair> for RsaPublicKey {
    fn from(keypair: &RsaKeypair) -> RsaPublicKey {
        keypair.public.clone()
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<&RsaKeypair> for Rsa<Private> {
    type Error = Error;

    fn try_from(key: &RsaKeypair) -> Result<Self> {
        key.native
            .get_or_init(|| {
                let convert = || -> Result<Rsa<Private>> {
                    fn number(value: &Mpint) -> Result<BigNum> {
                        let mut number = BigNum::new_secure()?;
                        number.copy_from_slice(value.as_positive_bytes().ok_or(Error::Crypto)?)?;
                        number.set_const_time();
                        Ok(number)
                    }
                    let n = number(key.public.n())?;
                    let e = number(key.public.e())?;
                    let d = number(&key.private.d)?;
                    let p = number(&key.private.p)?;
                    let q = number(&key.private.q)?;
                    let iqmp = number(&key.private.iqmp)?;
                    let mut ctx = BigNumContext::new_secure()?;
                    let mut pm1 = p.to_owned()?;
                    let mut qm1 = q.to_owned()?;
                    pm1.set_const_time();
                    qm1.set_const_time();
                    pm1.sub_word(1)?;
                    qm1.sub_word(1)?;
                    let mut dmp1 = BigNum::new_secure()?;
                    let mut dmq1 = BigNum::new_secure()?;
                    dmp1.set_const_time();
                    dmq1.set_const_time();
                    dmp1.nnmod(&d, &pm1, &mut ctx)?;
                    dmq1.nnmod(&d, &qm1, &mut ctx)?;
                    let native = Rsa::from_private_components(n, e, d, p, q, dmp1, dmq1, iqmp)?;
                    if !native.check_key()? {
                        return Err(Error::Crypto);
                    }
                    Ok(native)
                };
                convert().ok()
            })
            .clone()
            .ok_or(Error::Crypto)
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<Rsa<Private>> for RsaKeypair {
    type Error = Error;

    fn try_from(key: Rsa<Private>) -> Result<Self> {
        Self::try_from(&key)
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<&Rsa<Private>> for RsaKeypair {
    type Error = Error;

    fn try_from(key: &Rsa<Private>) -> Result<Self> {
        let public = RsaPublicKey::try_from(&Rsa::<Public>::from_public_components(
            key.n().to_owned()?,
            key.e().to_owned()?,
        )?)?;
        let mpint = |value: &openssl::bn::BigNumRef| {
            let bytes = zeroize::Zeroizing::new(value.to_vec());
            Mpint::from_positive_bytes(&bytes)
        };
        let private = RsaPrivateKey::new(
            mpint(key.d()),
            mpint(key.iqmp().ok_or(Error::Crypto)?),
            mpint(key.p().ok_or(Error::Crypto)?),
            mpint(key.q().ok_or(Error::Crypto)?),
        )?;
        let pair = Self::new(public, private)?;
        let _ = Rsa::<Private>::try_from(&pair)?;
        Ok(pair)
    }
}
