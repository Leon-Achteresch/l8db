# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-database provider registry (PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, ClickHouse, MongoDB, Redis, Oracle, Cassandra, DuckDB, ODBC) with per-family capabilities and driver status
- Connection management revamp: provider-aware editor, URL parsing and validation, connection summary and error redaction
- OS keychain secrets with in-memory fallback and SSH tunnel lifecycle (open on activation, restore on startup, never persisted ports)
- Database administration: extensions, sequences, functions, triggers, enums, schemas, roles and privileges, partitioning, logical replication (publications/subscriptions), sessions and locks, database overview
- Query power: history and saved queries, EXPLAIN visualization, SQL lint markers, CSV/JSON export
- Auto-updater backed by GitHub Releases with manual check in Settings
- CI (lint, typecheck, tests, Rust checks) and tag-triggered releases for macOS, Windows and Linux

### Fixed

- Passwords are stripped before connections are persisted

## [0.1.0] - 2026-09-06

Initial internal build.
