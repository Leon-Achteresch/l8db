# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two groups use l8db equally, often on the same connection:

- Developers and DBAs who write SQL daily, inspect schemas, tune queries and operate production databases.
- Business users without SQL knowledge who connect to a database to get answers, numbers, charts and exports in plain language.

Every surface, especially the AI assistant, must serve both without forcing either into the other's workflow.

## Product Purpose

l8db is a fast native desktop database client (Tauri v2, React 19, Rust) for PostgreSQL and many other database families: relational, document, key-value, analytical, object storage. It covers browsing, editing, querying, schema work, administration, transfer, versioning and an AI assistant. Success means people reach their data and get trustworthy answers faster than in any other client.

## Positioning

- The AI assistant runs on what the user already has: their own CLI agents (Codex, Claude Code, Gemini CLI, OpenCode, GitHub Copilot), their own API key (OpenAI, Anthropic, Google, OpenAI-compatible), or fully local models (Ollama, LM Studio). There is no l8db subscription.
- Safety is visible: approvals, read-only mode, production protection and masking are always perceivable, not buried in settings.
- Answers instead of SQL: results arrive as plain-language answers with charts and tables, with the SQL available but not in the way.
- Local and private: data stays on the machine, secrets live in the OS keychain, and local models are first-class.

## Operating Context

Desktop app on macOS, Linux and Windows, used for long sessions alongside editors and terminals. Connections may run through SSH tunnels and proxies and may be marked as production. Multiple windows can be open, each with its own active connection.

## Capabilities and Constraints

- AI assistant: side panel, full page (`/ai`) and minimized mode; chat history, per-connection sessions, connection and skill context, MCP servers, approval modes ("Immer fragen", tool-specific), plan mode, write permissions, charts and tables in answers with CSV/Excel export, executed SQL per step, follow-up questions, example questions, file attachments imported as new tables after approval, per-connection knowledge (table and column descriptions, glossary), usage and cost display, provider onboarding with a real connection test.
- A redesign may change structure, hierarchy and look, but no AI function may be removed.
- UI language is German.
- Features introduced to users are registered for NEW badges.

## Product Principles

1. Serve the SQL expert and the layperson on the same screen; depth is available, never imposed.
2. Show what the AI does to the database before and while it does it.
3. The user's own agent, key or local model is the engine; l8db is the cockpit.
4. Privacy is a default, not a setting.
