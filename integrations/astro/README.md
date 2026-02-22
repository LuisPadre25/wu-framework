# @wu-framework/astro

Astro integration for **wu-framework** microfrontends. Mount wu micro-apps inside any Astro site with zero runtime overhead at build time.

## Installation

```bash
npm install @wu-framework/astro wu-framework
```

## Quick Start

### 1. Add the integration

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import wu from '@wu-framework/astro';

export default defineConfig({
  integrations: [
    wu({
      apps: [
        { name: 'header', url: '/apps/header', strategy: 'eager' },
        { name: 'dashboard', url: '/apps/dashboard' }
      ]
    })
  ]
});
```

The integration injects the wu-framework runtime and auto-calls `wu.init()` with your apps config.

### 2. Mount micro-apps in pages

```astro
---
import WuApp from '@wu-framework/astro/WuApp.astro';
---

<WuApp name="header" />
<WuApp name="dashboard" lazy />
```

The `lazy` prop defers mounting until the element scrolls into view (uses `IntersectionObserver` with a 200px root margin).

## Components

### `WuApp`

Renders a mount point and calls `wu.mount()` on the client.

| Prop    | Type      | Default | Description                              |
| ------- | --------- | ------- | ---------------------------------------- |
| `name`  | `string`  | —       | Name of the registered micro-app         |
| `lazy`  | `boolean` | `false` | Defer mount until visible                |
| `class` | `string`  | —       | CSS class(es) for the container          |
| `style` | `string`  | —       | Inline styles for the container          |

### `WuShell`

Layout wrapper that calls `wu.init()` on the client. Useful when you want page-level control instead of the global integration.

```astro
---
import WuShell from '@wu-framework/astro/WuShell.astro';
---

<WuShell apps={[{ name: 'header', url: '/apps/header' }]}>
  <main>Page content here</main>
</WuShell>
```

| Prop      | Type           | Default | Description                 |
| --------- | -------------- | ------- | --------------------------- |
| `apps`    | `WuAppConfig[]`| —       | Micro-app definitions       |
| `sandbox` | `string`       | —       | Sandbox mode                |
| `debug`   | `boolean`      | `false` | Enable debug logging        |

## Integration Options

| Option    | Type            | Default | Description                                     |
| --------- | --------------- | ------- | ----------------------------------------------- |
| `apps`    | `WuAppConfig[]` | `[]`    | Auto-register apps via `wu.init()`              |
| `sandbox` | `string`        | —       | Global sandbox mode (`module`/`strict`/`eval`)  |
| `cdn`     | `string`        | —       | CDN URL for wu-framework UMD bundle             |
| `debug`   | `boolean`       | `false` | Enable debug logging                            |

## Usage Patterns

### Integration only (auto-init)

Use the integration in `astro.config.mjs` to auto-init, then mount with `WuApp`:

```astro
---
import WuApp from '@wu-framework/astro/WuApp.astro';
---
<WuApp name="header" />
```

### Shell layout (page-level init)

Skip the integration's `apps` option and use `WuShell` for per-page control:

```astro
---
import WuShell from '@wu-framework/astro/WuShell.astro';
import WuApp from '@wu-framework/astro/WuApp.astro';
---
<WuShell apps={[{ name: 'nav', url: '/apps/nav' }]}>
  <WuApp name="nav" />
  <slot />
</WuShell>
```

### CDN mode

Load wu-framework from a CDN instead of bundling it:

```js
wu({ cdn: 'https://cdn.example.com/wu-framework@1.1.8/dist/wu-framework.umd.js' })
```

## License

MIT
