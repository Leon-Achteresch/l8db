# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

Only the latest release receives security fixes.

## Reporting a Vulnerability

Report vulnerabilities via **GitHub Security Advisories**
(repository → Security → Advisories → New draft security advisory).
Do not open public issues for unpatched vulnerabilities.

Include: affected version, impact, and reproduction steps if available.
You will receive an initial response within 7 days.

## Secret Handling

Connection passwords live in the OS keychain (Keychain / Credential Manager /
Secret Service) and are never written to localStorage, logs, or error messages.
SSH tunnel ports are memory-only. When reporting bugs, redact hosts, usernames,
and connection strings.
