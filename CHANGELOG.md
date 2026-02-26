# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.17] - 2026-02-25 - Security Hardening & Quality

### Added

- ESLint flat config for code quality enforcement.
- Prettier configuration for consistent formatting.
- `lint`, `format`, `format:check` npm scripts.
- TypeScript declarations file (`src/index.d.ts`) for IDE autocompletion.
- JSDoc type annotations for core modules (WuStore, WuEventBus, WuLoader).
- Collision-safe framework access via `Symbol.for('wu-framework')`.
- One-time warning when EventBus runs in permissive mode (strictMode off).
- Rate-limit notification in WuCache (logged once per cooldown period).
- Manifest validation for optional fields: styleMode, version, folder.

### Changed

- WuScriptExecutor now validates scripts against dangerous patterns before execution (prototype pollution, sandbox escape, eval, dynamic import, cookie access).
- WuEventBus strictMode auto-enabled in production (NODE_ENV=production).
- WuPluginSystem API uses deep-freeze (recursive) instead of shallow Object.freeze.
- WuLoader cache now has LRU eviction (maxCacheSize=50, cacheTTL=30min).
- WuHtmlParser uses DOMParser instead of innerHTML (safer, no script execution during parse).
- WuErrorBoundary truncates stack traces to 5 lines and sanitizes context to prevent GC retention.
- WuLogger environment detection is SSR-safe, removed fragile port check, defaults to production.
- WuProxySandbox and WuPluginSystem constructors accept options for configurable timeouts.
- WuStore ring buffer cursor uses modular wrap-around to prevent overflow.

### Fixed

- 26 failing tests in keep-alive.test.js (incomplete logger mock).
- 2 failing tests in multi-app-isolation.test.js (incomplete logger mock).
- Mount failure now cleans up sandbox/shadow DOM to prevent orphaned DOMs.
- Cache no longer silently drops operations when rate-limited.

## [1.1.16] - Universal Microfrontends Framework

### Added

- Initial stable release with 8 framework adapters.
- Shadow DOM isolation with 3 sandbox strategies (module, strict, eval).
- Event bus with namespaces, wildcards, and replay.
- Shared reactive store with ring buffer.
- Plugin system with lifecycle hooks.
- AI integration (4 paradigms: App-to-LLM, LLM-to-App, Autonomous Agent, Cross-App).
- WebMCP and MCP Server connectivity.
- Astro integration.
- 624 passing tests.

## [1.1.15] - Previous Release

### Fixed

- Documentation fixes.
- React 19 compatibility fix.
