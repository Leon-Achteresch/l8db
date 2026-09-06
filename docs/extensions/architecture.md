# Extension architecture decision

## Existing architecture audited

React 19 views are organized under `src/features`, with shared logic under `src/lib`. TanStack routes are thin/generated. Zustand owns connections, database selection and persisted user state. Sonner is the notification surface. All Tauri invocations are centralized in `src/lib/db.ts`. Rust manages providers, pools, SSH and transactions through Tauri state and reports command errors as strings. Tests use Bun and Rust's built-in runner. Version checks keep package, Cargo and Tauri app versions aligned. There is no existing community plugin loader, application CLI, general DI container, command bus or core event bus. Existing `installExtension` and extension views operate on PostgreSQL server extensions.

No Graphify graph existed in the checkout; concrete decisions were derived from direct inspection of these source files. Existing work in provider, transaction and workspace features is independent of this change.

## Boundaries

```text
main.tsx composition root
  ├─ existing Zustand selection subscriptions / Sonner
  └─ ExtensionManager (instance passed through React context)
       ├─ ExtensionRegistry / CommandRegistry / ConfigurationRegistry
       ├─ PermissionManager / typed EventBus
       ├─ ExtensionLoader → ExtensionRuntime
       │                    └─ SandboxRuntime
       │                         └─ opaque iframe → dedicated worker
       │                              └─ Public API v1 RPC facade → package
       └─ ExtensionStorage → TauriExtensionStorage
                              └─ centralized db.ts invoke → Rust app-data store
```

Only `packages/extension-api` is public. The SDK consumes public validation/types and Bun's bundler; it imports no host module. The loader consumes a runtime interface, not the sandbox implementation. The manager is constructed with storage/runtime/core abstractions, not global singletons. Only the composition root adapts existing application stores and notifications. The settings view uses the existing React context pattern and UI primitives, without introducing a competing route or settings store.

The command registry separates contributed reservations from runtime handlers. Resource ownership is per extension. The configuration registry reserves keys and validates writes. Manifest validation and semver checks are shared with the SDK. Dependencies form a checked directed graph; activation is deduplicated and cycles rejected before awaiting other activations. Installation mutations are serialized, and backend writes are serialized separately. Event payloads and list results are snapshots.

## Runtime choice

Tauri does not embed Node, so a Node host would require another distributable runtime and cross-platform packaging. An unsandboxed Node sidecar would also defeat filesystem/process permissions. API v1 instead uses web engines already present with Tauri and provides no ambient privileged APIs. An opaque iframe is necessary: a worker created directly by the main window could inherit its origin and storage privileges. The worker prevents synchronous extension loops from blocking the UI thread. Its supervisor iframe can terminate it and the host imposes RPC deadlines.

The iframe uses an explicit CSP; blob workers inherit their creator's policy. See [MDN CSP worker behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers) and [worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src). No worker-specific promises of OS process separation or memory isolation are made. A future native runtime must preserve the protocol, implement authenticated extension identity, enforce permissions at its broker and impose OS quotas. It must not add a privileged in-process fallback.

## Extension points

Add future contributions through a public manifest schema and a registry handler with validation, ownership and disposal, then inject host-specific adapters at the composition root. Do not pass live views, database adapters, Zustand stores or Tauri clients to extensions. New RPC methods need runtime argument validation, permissions and positive/negative tests. A remote registry provider only supplies validated packages; it cannot activate or grant privileges itself.
