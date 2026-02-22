/**
 * @wu-framework/astro — Astro integration for wu-framework microfrontends.
 *
 * Injects the wu-framework runtime into Astro pages and optionally
 * auto-initializes registered micro-apps via wu.init().
 *
 * @example
 * // astro.config.mjs
 * import wu from '@wu-framework/astro';
 *
 * export default defineConfig({
 *   integrations: [
 *     wu({
 *       apps: [
 *         { name: 'header', url: '/apps/header', strategy: 'eager' },
 *         { name: 'dashboard', url: '/apps/dashboard' }
 *       ]
 *     })
 *   ]
 * });
 */

/**
 * @param {import('./types').WuIntegrationOptions} options
 * @returns {import('astro').AstroIntegration}
 */
export default function wuIntegration(options = {}) {
  const {
    apps = [],
    sandbox,
    cdn,
    debug = false,
  } = options;

  return {
    name: '@wu-framework/astro',
    hooks: {
      'astro:config:setup': ({ injectScript, updateConfig }) => {
        // 1. Inject wu-framework runtime
        if (cdn) {
          // Use external CDN script (client-only)
          injectScript(
            'head-inline',
            `(function(){var s=document.createElement('script');s.src='${cdn}';s.defer=true;document.head.appendChild(s);})()`
          );
        }

        // 2. Auto-init if apps are provided (client-only via 'page')
        if (apps.length > 0) {
          const initConfig = JSON.stringify({ apps, sandbox, debug });
          injectScript(
            'page',
            `import('wu-framework').then(function(m){m.wu.init(${initConfig});});`
          );
        }

        // 3. Ensure Vite resolves wu-framework correctly
        updateConfig({
          vite: {
            optimizeDeps: {
              include: ['wu-framework'],
            },
          },
        });
      },
    },
  };
}
