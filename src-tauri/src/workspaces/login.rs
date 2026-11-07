use std::collections::HashMap;
use std::hash::Hash;
use std::net::IpAddr;
use std::time::{Duration, Instant};

const CAPACITY: usize = 256;
const WINDOW: Duration = Duration::from_secs(300);
const ACCOUNT_ATTEMPTS: u16 = 10;
const PEER_FAILURES: u16 = 32;

struct Counter {
    started: Instant,
    count: u16,
}

#[derive(Default)]
pub(super) struct LoginLimits {
    accounts: HashMap<String, Counter>,
    unknown_emails: HashMap<String, Counter>,
    peers: HashMap<IpAddr, Counter>,
}

fn expired(counter: &Counter, now: Instant) -> bool {
    now.saturating_duration_since(counter.started) >= WINDOW
}

fn record<K: Clone + Eq + Hash>(
    counters: &mut HashMap<K, Counter>,
    key: K,
    maximum: u16,
    now: Instant,
) -> bool {
    if !counters.contains_key(&key) && counters.len() >= CAPACITY {
        let oldest = counters
            .iter()
            .min_by_key(|(_, counter)| {
                (
                    !expired(counter, now),
                    counter.count >= maximum,
                    counter.started,
                )
            })
            .map(|(key, _)| key.clone());
        if let Some(oldest) = oldest {
            counters.remove(&oldest);
        }
    }
    let counter = counters.entry(key).or_insert(Counter {
        started: now,
        count: 0,
    });
    if expired(counter, now) {
        counter.started = now;
        counter.count = 0;
    }
    counter.count = counter.count.saturating_add(1);
    counter.count <= maximum
}

impl LoginLimits {
    pub(super) fn admit(
        &mut self,
        account: Option<&str>,
        email: &str,
        peer: IpAddr,
        now: Instant,
    ) -> bool {
        if let Some(account) = account {
            return record(
                &mut self.accounts,
                account.to_owned(),
                ACCOUNT_ATTEMPTS,
                now,
            );
        }
        if self
            .peers
            .get(&peer)
            .is_some_and(|counter| !expired(counter, now) && counter.count >= PEER_FAILURES)
        {
            return false;
        }
        record(
            &mut self.unknown_emails,
            email.to_owned(),
            ACCOUNT_ATTEMPTS,
            now,
        )
    }

    pub(super) fn failed(&mut self, peer: IpAddr, now: Instant) -> bool {
        !record(&mut self.peers, peer, PEER_FAILURES, now)
    }

    pub(super) fn succeeded(&mut self, account: &str, email: &str) {
        self.accounts.remove(account);
        self.unknown_emails.remove(email);
    }

    #[cfg(test)]
    pub(super) fn sizes(&self) -> [usize; 3] {
        [
            self.accounts.len(),
            self.unknown_emails.len(),
            self.peers.len(),
        ]
    }

    #[cfg(test)]
    pub(super) fn retained_key_and_bucket_bytes(&self) -> usize {
        let strings = [&self.accounts, &self.unknown_emails]
            .into_iter()
            .map(|map| {
                map.capacity() * (std::mem::size_of::<(String, Counter)>() + 1)
                    + map.keys().map(String::capacity).sum::<usize>()
            })
            .sum::<usize>();
        strings
            + self.peers.capacity() * (std::mem::size_of::<(IpAddr, Counter)>() + 1)
            + std::mem::size_of::<Self>()
    }
}
