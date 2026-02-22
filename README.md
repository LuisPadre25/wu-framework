<p align="center">
  <img src="https://wu-framework.dev/favicon.svg" width="80" alt="Wu Framework" />
</p>

<h1 align="center">Wu Framework</h1>

<p align="center">
  <strong>Universal microfrontends with built-in AI. Zero dependencies.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/wu-framework"><img src="https://img.shields.io/npm/v/wu-framework.svg?color=8b5cf6&label=npm" alt="npm version" /></a>
  <a href="https://github.com/wu-framework/wu-framework/actions"><img src="https://img.shields.io/github/actions/workflow/status/wu-framework/wu-framework/ci.yml?label=tests&color=10b981" alt="tests" /></a>
  <img src="https://img.shields.io/badge/tests-650%20passed-10b981" alt="650 tests" />
  <img src="https://img.shields.io/badge/dependencies-0-8b5cf6" alt="zero deps" />
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://wu-framework.dev">Documentation</a> &middot;
  <a href="https://wu-framework.dev/docs/quick-start">Quick Start</a> &middot;
  <a href="https://wu-framework.dev/docs/ai/overview">AI Integration</a> &middot;
  <a href="#wucommerce--real-world-example">Live Example</a>
</p>

---

Run **React, Vue, Angular, Svelte, Solid, Preact, Lit, and Vanilla JS** micro-apps side by side in the same page. Each app lives in its own Shadow DOM with full CSS isolation. Apps communicate through a shared event bus and store — no tight coupling, no iframes.

Add AI to any app with one line. Connect your own LLM (OpenAI, Anthropic, Ollama) and your app gains context-aware tool calling, autonomous agents, and cross-app orchestration. **WebMCP ready** for Chrome 146+.

```bash
npm install wu-framework
```

## 30-Second Demo

```js
import { wu } from 'wu-framework';
import { wuReact } from 'wu-framework/adapters/react';
import { wuVue } from 'wu-framework/adapters/vue';

// Register micro-apps from different frameworks
wuReact.register('cart', CartApp);
wuVue.register('catalog', CatalogApp);

// Mount them — each gets its own Shadow DOM
await wu.mount('cart', '#cart-container');
await wu.mount('catalog', '#catalog-container');

// They talk to each other via events
wu.emit('cart:item-added', { productId: 'SKU-42' });
wu.on('catalog:product-selected', (e) => console.log(e.data));

// Add AI with one line — BYOL (Bring Your Own LLM)
wu.ai.provider('openai', { endpoint: '/api/ai/chat', model: 'gpt-4o' });
wu.ai.action('addToCart', {
  description: 'Add a product to the shopping cart',
  parameters: { productId: { type: 'string', required: true } },
  handler: async (params) => wu.emit('cart:item-added', params),
});

// Now the AI can control your app
await wu.ai.send('Add product SKU-42 to the cart');
```

## Why Wu?

| | **Wu Framework** | **single-spa** | **Module Federation** | **iframes** |
|---|:---:|:---:|:---:|:---:|
| Framework adapters | **8** | 4 | 1* | Any |
| Shadow DOM isolation | Yes | No | No | Yes (heavy) |
| Shared event bus | Built-in | Manual | Manual | postMessage |
| Shared store | Built-in | Manual | Manual | No |
| Standalone mode | Automatic | No | No | N/A |
| AI integration | Built-in | No | No | No |
| WebMCP (Chrome 146+) | Built-in | No | No | No |
| MCP Server (dev tools) | Built-in | No | No | No |
| Dependencies | **0** | 0 | Webpack 5 | N/A |
| Bundle size (min) | ~174 KB | ~10 KB | Varies | N/A |

*Module Federation is Webpack-coupled; Wu is bundler-agnostic.

---

## Features

### Core

- **8 Framework Adapters** — React, Vue, Angular, Svelte, Solid, Preact, Lit, Vanilla
- **Shadow DOM Isolation** — CSS and DOM fully sandboxed per app
- **3 Sandbox Strategies** — Shadow DOM, Proxy, iframe — choose per app
- **3 CSS Isolation Modes** — `shared`, `isolated`, `fully-isolated` per app
- **Event Bus** — Namespaced pub/sub with wildcards, replay, and middleware
- **Shared Store** — Cross-app reactive state with dot-path notation and persistence
- **Plugin System** — Extend Wu with lifecycle hooks
- **Performance Monitor** — Mount time, memory, FPS tracking per app
- **Error Boundaries** — Catch and recover from micro-app failures
- **Keep-Alive** — Preserve app state when hiding/showing
- **Prefetch** — Speculation Rules API with automatic fallback chain
- **Cookie Overrides** — QA redirects individual apps to different URLs per-browser
- **Standalone Mode** — Every micro-app works without a shell, zero lock-in

### AI (BYOL — Bring Your Own LLM)

- **4 Paradigms** — App→LLM, LLM→App, Autonomous Agent, Cross-App Orchestration
- **Tool Calling** — Register actions the AI executes autonomously
- **Streaming** — Async generator for real-time responses
- **Multi-turn** — Namespaced conversations with history
- **Reactive Triggers** — Events automatically invoke the AI
- **Auto Context** — Store state, apps, events injected into the system prompt
- **10 Browser Actions** — Screenshot, click, type, navigate, read console/network
- **WebMCP** — `wu.ai.expose()` registers tools via `navigator.modelContext` (Chrome 146+)
- **MCP Server** — Connect Claude Code, Cursor, or any MCP client to your live app
- **4-Layer Security** — Permissions, rate limiting, circuit breaker, loop protection
- **Workflows** — Reusable parameterized AI recipes

---

## Quick Start

### 1. Register your micro-app

```jsx
// React
import { wuReact } from 'wu-framework/adapters/react';
wuReact.register('orders', App);

// Vue
import { wuVue } from 'wu-framework/adapters/vue';
wuVue.register('products', App);

// Angular (standalone)
import { wuAngular } from 'wu-framework/adapters/angular';
wuAngular.registerStandalone('settings', AppComponent, { createApplication, createComponent });

// Svelte 5
import { wuSvelte } from 'wu-framework/adapters/svelte';
wuSvelte.registerSvelte5('dashboard', App);

// Same pattern for Solid, Preact, Lit, Vanilla
```

### 2. Mount from the shell

```js
import { wu } from 'wu-framework';

await wu.init({
  apps: [
    { name: 'header',  url: 'http://localhost:3001' },
    { name: 'sidebar', url: 'http://localhost:3002' },
    { name: 'content', url: 'http://localhost:3003' },
  ]
});

await wu.mount('header',  '#header-container');
await wu.mount('sidebar', '#sidebar-container');
await wu.mount('content', '#content-container');
```

### 3. Cross-app communication

```js
import { emit, on, getState, setState } from 'wu-framework';

// Events
emit('user:login', { userId: 123 });
on('user:*', (event) => console.log(event.data));

// Shared store
setState('user.name', 'John');
getState('user.name'); // 'John'
```

### 4. Add AI (optional)

```js
wu.ai.provider('ollama', {
  endpoint: 'http://localhost:11434/api/chat',
  model: 'llama3',
});

const response = await wu.ai.send('What apps are mounted?');
```

---

## WuCommerce — Real-World Example

Wu ships with **WuCommerce**, a Shopify-like merchant dashboard where every section is a real micro-app built with a different framework.

| Micro-app | Framework | What it does |
|-----------|-----------|-------------|
| **Topbar** | Preact | Store name, nav tabs, search, notifications, theme toggle |
| **Dashboard** | Svelte 5 | KPI cards, sparklines, recent orders, revenue chart |
| **Orders** | React | Order table with filters, search, status badges |
| **Products** | Vue 3 | Product catalog grid, stock badges, category filter |
| **Customers** | Solid.js | Customer list, segment badges, click-to-filter-orders |
| **Analytics** | Lit | Revenue bar chart, traffic donut, top products |
| **Chat** | Vanilla JS | Floating chat widget with conversations and messages |
| **Settings** | Angular 21 | Store config form, shipping zones, payment methods |

All 8 apps communicate through Wu's event bus and shared store. Click a customer → orders filter. Toggle theme → all 8 apps update. Change store name in settings → topbar updates.

---

## 3 Sandbox Strategies

| Mode | How it works | Tree shaking | Source maps | HMR | JS isolation |
|------|-------------|:---:|:---:|:---:|:---:|
| `module` (default) | `import()` + Proxy side-effect tracking | Yes | Yes | Yes | Side effects only |
| `strict` | Hidden iframe + real `import()` | Yes | Yes | Yes | **Full** (separate window) |
| `eval` | Fetch HTML → parse → `with(proxy){}` | No | No | No | **Full** (proxy traps) |

```js
await wu.init({
  apps: [
    { name: 'header',    url: '...', sandbox: 'module' },
    { name: 'analytics', url: '...', sandbox: 'strict' },
    { name: 'legacy',    url: '...', sandbox: 'eval' },
  ]
});
```

**Auto-cleaned on unmount:** timers, intervals, rAF, event listeners, localStorage keys, DOM mutations.

---

## 3 CSS Isolation Modes

| Mode | What happens | When to use |
|------|-------------|-------------|
| `shared` | Host styles injected into Shadow DOM | Apps sharing a design system (Tailwind) |
| `isolated` | Pure Shadow DOM — no external styles | Fully independent apps |
| `fully-isolated` | Only the app's own styles | Apps that need their CSS but not global CSS |

```json
{ "name": "my-app", "entry": "index.js", "styleMode": "isolated" }
```

---

## AI Paradigms

### 1. App → LLM → App

```js
const response = await wu.ai.send('What items are in the cart?');
```

### 2. LLM → App → LLM (WebMCP)

```js
wu.ai.expose(); // Registers all tools via navigator.modelContext (Chrome 146+)
```

### 3. Autonomous Agent

```js
for await (const step of wu.ai.agent('Find the top customer and show their profile')) {
  console.log(`Step ${step.step}: ${step.content}`);
}
```

### 4. Cross-App Orchestration

```js
const result = await wu.ai.intent('Find customer Emma and refund order #4821');
console.log(result.appsInvolved); // ['customers', 'orders']
```

---

## Plugins & Hooks

```js
import { usePlugin, createPlugin, useHook } from 'wu-framework';

usePlugin(createPlugin({
  name: 'analytics',
  install: (api) => api.on('app:mounted', (e) => track(e)),
  afterMount: async (ctx) => log('mounted in', ctx.mountTime, 'ms')
}));

useHook('beforeMount', async (context, next) => {
  console.log('Mounting:', context.appName);
  await next();
});
```

Phases: `beforeInit` → `afterInit` → `beforeLoad` → `afterLoad` → `beforeMount` → `afterMount` → `beforeUnmount` → `afterUnmount`

---

## Prefetch (Speculation Rules API)

```js
wu.prefetch(['sidebar', 'analytics']);
wu.prefetch(['sidebar'], { trigger: 'hover', action: 'prerender' });
wu.prefetchAll();
```

Fallback chain: Speculation Rules API (Chrome 121+) → `<link rel="modulepreload">` → `<link rel="prefetch">`

---

## Cookie Overrides for QA

```js
wu.override('sidebar', 'http://localhost:5174');
wu.getOverrides();   // { sidebar: 'http://localhost:5174' }
wu.removeOverride('sidebar');
```

QA sets a cookie → only **their browser** sees the override. Everyone else sees production. 3-layer security: environment gate, domain allowlist, visual indicator.

---

## Project Stats

| Metric | Value |
|---|---|
| Source files | 79 |
| Lines of code | 23,442 |
| Test cases | **650** |
| Framework adapters | 8 |
| AI modules | 12 |
| Core modules | 23 |
| Runtime dependencies | **0** |
| Bundle (ESM, minified) | ~174 KB |

---

## Build

```bash
npm run build          # ESM + CJS + UMD + Dev
npm run test           # 650 tests (Vitest)
npm run test:coverage  # Coverage report
```

| Output | Format | Use |
|--------|--------|-----|
| `wu-framework.esm.js` | ES Module | Bundler imports |
| `wu-framework.cjs.js` | CommonJS | Node.js require |
| `wu-framework.umd.js` | UMD | CDN / script tag |
| `wu-framework.dev.js` | ES Module | Development |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                       SHELL (any framework)                          │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────────────┤
│ Shadow   │ Shadow   │ Shadow   │ Shadow   │ Shadow   │ Shadow   ...  │
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐    │
│ │Topbar│ │ │Dashbd│ │ │Orders│ │ │Produc│ │ │Custo.│ │ │Analyt│    │
│ │Preact│ │ │Svelte│ │ │React │ │ │Vue 3 │ │ │Solid │ │ │ Lit  │    │
│ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘    │
├──────────┴──────────┴──────────┴──────────┴──────────┴───────────────┤
│                       WU FRAMEWORK CORE                              │
│  Sandbox (module/strict/eval) · EventBus (wildcards, replay)         │
│  Store (dot-paths, batch) · StyleBridge (shared/isolated/fully-iso)  │
│  Loader · Hooks · Plugins · Cache · Prefetch · Overrides             │
├──────────────────────────────────────────────────────────────────────┤
│                       WU AI (BYOL)                                   │
│  Provider · Actions · Agent · Orchestrate · Triggers · Context       │
│  Browser Actions · WebMCP · MCP Server · Workflows · Security        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Documentation

Full documentation at **[wu-framework.dev](https://wu-framework.dev)**

- [Quick Start](https://wu-framework.dev/docs/quick-start) — Get running in 5 minutes
- [Getting Started](https://wu-framework.dev/docs/getting-started) — Deeper tutorial with cross-app communication
- [API Reference](https://wu-framework.dev/docs/core/api) — Full API docs
- [Event Bus](https://wu-framework.dev/docs/core/event-bus) — Inter-app communication
- [Shared Store](https://wu-framework.dev/docs/core/store) — Cross-app reactive state
- [Sandbox](https://wu-framework.dev/docs/core/sandbox) — JS isolation strategies
- [AI Overview](https://wu-framework.dev/docs/ai/overview) — 4 AI paradigms
- [AI Actions](https://wu-framework.dev/docs/ai/actions) — Register tools for the LLM
- [Browser Actions](https://wu-framework.dev/docs/ai/browser-actions) — 10 built-in browser tools
- [MCP Server](https://wu-framework.dev/docs/ai/mcp-server) — Connect AI agents to live apps
- [CSS Isolation](https://wu-framework.dev/docs/guides/css-isolation) — Shadow DOM style modes
- [Deployment](https://wu-framework.dev/docs/guides/deployment) — Production deployment guide

---

## Browser Support

Chrome 80+, Firefox 78+, Safari 14+, Edge 80+. Shadow DOM v1 required.

## Contributing

Contributions welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](./LICENSE) — Free for personal and commercial use.

See [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md) for optional enterprise support and consulting.
