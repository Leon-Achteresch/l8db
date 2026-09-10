# Community Extensions (API v1)

Community Extensions extend the l8db desktop application. They are distinct from PostgreSQL server extensions. Manage them in **Settings → Community Extensions**. No source modification or l8db rebuild is required to load an extension into an application that includes this host.

## Creating your first extension

Install Bun 1.3 or later. The repository example is ready to build:

```sh
bun install
bun run extension pack examples/hello-extension ./community.hello-1.0.0.l8db-extension
```

In l8db, install that file, review its publisher, grant `database:read`, and click **Aktivieren**. Click **Hello: Greet** to activate it lazily and display a notification. Selecting a database activates it through `onDatabaseOpen` and produces an extension log. Configuration accepts a JSON override, for example `{"hello.enabled":false}`. Disable to release resources, reload to create a fresh runtime, or uninstall to remove the package, settings and extension storage.

For an independent project use:

```text
my-extension/
  src/extension.ts
  package.json
  l8db-extension.json
  tsconfig.json
  assets/                 optional UTF-8 assets
  dist/extension.js       generated
```

The public packages are `@l8db/extension-api@1.0.0` and `@l8db/extension-sdk@1.0.0`. They are publishable Bun workspace packages; this implementation does not publish them to npm automatically. Until the maintainer publishes them, distribute their tarballs (see Publishing) or use local `file:` dependencies as the included example does. Once available from your chosen npm registry:

```sh
bun add -d @l8db/extension-api@^1 @l8db/extension-sdk@^1 typescript
bunx l8db-extension build .
bunx l8db-extension validate .
bunx l8db-extension pack .
```

Use `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `target: "ES2020"` and `noEmit: true` for TypeScript. The SDK bundles `src/extension.ts` and all browser-compatible dependencies into the manifest's entry point. It emits CommonJS internally; authors write TypeScript/ES module exports. Runtime imports, Node built-ins and unbundled chunks are unsupported. The type-only API import disappears from the compiled code.

```ts
import type { ExtensionContext, L8dbApi } from '@l8db/extension-api'

export function activate(context: ExtensionContext, api: L8dbApi) {
  context.subscriptions.push(api.commands.registerCommand('hello.greet', async () => {
    if (await api.configuration.get<boolean>('hello.enabled')) {
      await api.notifications.showInfo('Hello l8db')
    }
  }))
  context.subscriptions.push(api.events.onDatabaseOpened(database => {
    api.logger.info(`Database opened: ${database.name}`)
  }))
}

export function deactivate() {}
```

## Manifest

See [the complete example](../../examples/hello-extension/l8db-extension.json), [public types](../../packages/extension-api/src/index.ts), and [JSON Schema](../../packages/extension-api/schema.json). An editor can reference the schema through `node_modules/@l8db/extension-api/schema.json`. Runtime validation additionally checks semantic versions, path safety, publisher/ID agreement, command references and duplicate IDs; JSON Schema alone is not sufficient.

Required fields: `id`, `publisher`, `name`, `version`, `engines.l8db`, `main`, `activationEvents`. ID is `publisher.name`, lowercase letters, digits and hyphens, maximum 160 characters. The publisher must match the ID prefix. Versions and dependency ranges use npm SemVer. `engines.api` defaults to `^1.0.0`; another API major is rejected. The current app version is 0.1.0, so `>=1.0.0` would correctly prevent activation today.

Optional fields: `description`, `permissions`, `dependencies` and `contributes`. Dependencies map extension IDs to version ranges. They must already be installed and enabled; the host activates them first. Missing, disabled, incompatible and cyclic dependencies fail only the requesting extension. Dependency installation is explicit. Stopping a dependency stops its active dependents; their next activation rechecks it.

`contributes.commands` reserves globally unique command IDs and human-readable titles. `contributes.configuration` maps globally unique keys to a boolean, string or number schema with a matching default and optional description. Unknown contribution types are rejected in API v1. Future versions can add contribution handlers and public schemas without exposing private core modules.

## Lifecycle and activation

`discovered → validated → loaded → activated → deactivated`, with `failed` available at validation, loading or execution failure. `listExtensions()` returns snapshots including current state and error. Installation never executes code and starts disabled with no grants. On app restart discovery restores packages, enablement, grants and settings. Runtime objects and command handlers are never persisted.

`onStartup` activates after core startup. `onDatabaseOpen` activates when the active database selection changes. `onCommand:<id>` declares lazy command activation. Executing any contributed command from the host activates its owner first. Parallel commands share an activation promise. API registration failures make activation fail. Reload terminates and recreates the sandbox; there is no in-process fallback.

The host invokes optional `deactivate()`, disposes tracked resources and terminates the worker even if cleanup throws or exceeds the timeout. Command and event registrations are automatically tracked; `context.subscriptions` also accepts custom synchronous disposables. Make custom disposables idempotent. `extensionPath` and `storagePath` are virtual identities, not native paths. Use assets/storage APIs to access data.

## Public API

All transport values must be JSON-compatible. No functions, live objects, database passwords, URLs, stores, adapters, React objects or Tauri handles cross the API.

| API | Behavior |
| --- | --- |
| `commands.registerCommand(id, handler)` | Register a declared command; returns a disposable. Duplicate registrations fail. Host acknowledgement is awaited before activation completes. |
| `commands.executeCommand(id, payload?)` | Invoke an active extension command. Cross-extension calls require a declared dependency; activate must not call its own commands before activation finishes. |
| `events.onDatabaseOpened(listener)` | Active database selection opened; requires `database:read`. |
| `events.onDatabaseClosed(listener)` | Previous active database selection closed; requires `database:read`. |
| `database.getActive()` | `{connectionId, name, kind}` or null; requires `database:read`. Does not return credentials or execute SQL. |
| `configuration.get<T>(key)` | Read own declared setting, using persisted override or manifest default. Host validates writes through the settings UI. |
| `notifications.showInfo(message)` | Display a Sonner information notification. |
| `assets.readText(path)` | Read a UTF-8 file from the installed archive by its safe relative path. |
| `storage.get(key)`, `storage.set(key, value)` | Own persistent JSON storage; requires `filesystem:extension-storage`. Keys use letters, digits, `_`, `-`, maximum 80 characters. Total quota: 1 MiB. |
| `logger.info/warn/error(message)` | Host-prefixed logs visible in settings and the console. Last 300 entries retained in memory. |

Database events refer to the selected workspace database, not server socket state or external database changes. Record-created/updated/deleted events are deliberately absent: providers, transactions, raw SQL and external writes currently have no unified committed-change event. Adding such an event requires a real core abstraction first.

## Permissions and security

Manifest requests are not grants. Users select supported grants when enabling an extension; changing grants stops its runtime. Every RPC checks the extension identity bound to its private channel, method, arguments, ownership and required grant. Extension storage checks persisted grants again in Rust.

| Permission | API v1 |
| --- | --- |
| `database:read` | Active selection metadata and selection events only |
| `filesystem:extension-storage` | Extension-scoped JSON storage only |
| `database:write` | Reserved; cannot be granted |
| `network` | Reserved; cannot be granted; browser connections blocked by CSP |
| `filesystem` | Reserved; no general filesystem API |
| `clipboard:read`, `clipboard:write` | Reserved; no clipboard API |
| `process:execute` | Reserved; no process API |

A bundled extension runs in a dedicated worker created inside an opaque-origin iframe (`sandbox="allow-scripts"`, without `allow-same-origin`). It has no DOM, Node, Tauri bridge or core module imports. The iframe's CSP denies connections and other resources; blob workers inherit that policy. The only host communication is a private MessageChannel with an explicit method allowlist. Code is compiled/evaluated solely in the worker. The main window's existing CSP and capability configuration are not broadened.

This is **browser isolation, not an OS sandbox**. Workers can still consume memory; browser engine defects and process-level out-of-memory failures can affect the application. Each request has a 10-second timeout and each extension a 500-message/second RPC limit, but there is no hard CPU/memory quota. A native host process with OS-level limits remains the stronger future option. The runtime interface allows replacing the sandbox without changing extensions or the loader. No in-process execution mode is provided.

The model also assumes the OS account and l8db core are trusted. Publisher strings are self-declared; packages are not cryptographically signed and there is no publisher verification, marketplace moderation or automatic updater. Obtain packages from trusted sources and verify release checksums independently. Permissions do not prevent an extension from intentionally returning data through a command you invoke; review dependency chains as well as the top-level extension.

## Local development

```sh
bun run extension dev ./examples/hello-extension
```

For independent projects the equivalent is `bunx l8db-extension dev .`. It builds and validates the project and prints the directory to select through **Entwicklungsordner laden**. The app keeps the development path with a validated snapshot. Run the build again and click **Neu laden** to read fresh code/assets directly from that directory without repackaging. A changed manifest requires reinstalling to review contributions and permissions. On app restart the last installed snapshot loads; click Reload to refresh development files. There is no filesystem watcher or hidden dev server.

The repository had no application CLI or CLI parser. Installation/list/enable/disable/uninstall are therefore integrated into the existing desktop settings rather than a second native CLI. The small SDK CLI provides build, validate, pack and dev without adding a CLI framework.

## Packaging and installation

`.l8db-extension` is a versioned, uncompressed UTF-8 JSON envelope:

```json
{
  "format": 1,
  "manifest": { "...": "validated l8db-extension.json contents" },
  "files": { "dist/extension.js": "compiled code", "assets/help.txt": "help text" }
}
```

There are at most 256 files and 8 MiB per serialized package. Assets are UTF-8 text (including SVG or JSON); arbitrary binary assets are not supported in format 1. No archive paths are extracted into the host filesystem. Absolute, parent-traversal and Windows reserved paths are rejected. Development imports reject escaping symlinks. The app stores a package envelope, flags/configuration and separate JSON storage under Tauri's app-data directory, `community-extensions/<publisher.name>/`. New installs use a staging directory and atomic rename. Settings/storage writes also use a temporary file and rename, serialized by a managed Rust mutex.

Installing over an existing ID is rejected. To update a release in v1, uninstall then install the new version; this deletes extension data and requires reviewing grants again. Automatic data-preserving updates and migration hooks are future work. Uninstall removes the extension directory, including its storage. A corrupt on-disk package is skipped and logged by Rust; a readable but invalid/incompatible manifest appears as failed in the extension UI.

## Publishing

1. Choose a stable publisher/ID and bump the extension's own SemVer version.
2. Set honest `engines.l8db` and API ranges; declare only needed permissions and dependencies.
3. Typecheck, build and validate. Test install, command/event behavior and deactivation in l8db.
4. Run `l8db-extension pack .` and publish the resulting file on a GitHub release or other distribution service, together with a checksum, license, changelog, source and required grants.
5. Users download and install the local package. No marketplace account is needed.

Maintainers can distribute SDK/API packages with `bun pm pack` from each package directory. Install the API tarball before the SDK tarball in an external project, or publish API then SDK to an npm registry controlled by the maintainer (`npm publish --access public`). Actual registry publication needs the owner's account and is not performed by this implementation. The example's local `file:` dependencies must be replaced by published versions or tarball paths when copying it outside this repository.

The public `ExtensionRegistryProvider` interface (`search`, `get`, `download`) describes a future package catalog. The local manager depends only on `ExtensionStorage` and `ExtensionArchive`, so a provider can supply packages to `installExtension()` without a marketplace-specific manager. No public marketplace backend is implemented.

## API compatibility and architecture

See [architecture](architecture.md). App compatibility follows the synchronized versions in root `package.json`, Cargo and Tauri config. API/SDK have independent 1.0.0 versions. API v1 changes must remain additive; breaking semantics require a new major, explicit manifest compatibility and a runtime implementation for that version. Never export internal host classes from the public API package.

## Tests

```sh
bun run test
cargo test --manifest-path src-tauri/Cargo.toml --lib community_extensions::tests
L8DB_EXTENSION_BROWSER=chrome bun test tests/extension-browser.test.ts
bunx playwright install webkit
L8DB_EXTENSION_BROWSER=webkit bun test tests/extension-browser.test.ts
```

The default suite runs domain and SDK tests and skips browser tests. The explicit browser suite uses Bun's test runner plus Playwright to verify actual sandbox execution, disposal, CSP denial, permission checks and termination of an infinite activation loop. `chrome` uses an installed Google Chrome; `webkit` uses Playwright WebKit. These are engine-level integration checks, not a claim that every bundled Tauri/WebView version or OS has been certified.
