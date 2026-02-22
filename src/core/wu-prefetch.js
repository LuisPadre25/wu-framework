/**
 * WU-PREFETCH: Intelligent Prefetching with Speculation Rules API
 *
 * Prefetches microfrontend modules BEFORE they're needed using:
 * 1. Speculation Rules API (Chrome 121+) — browser-native prerender/prefetch
 * 2. <link rel="modulepreload"> — ES module prefetch (all modern browsers)
 * 3. <link rel="prefetch"> — generic fallback
 *
 * Trigger modes:
 * - immediate: prefetch now
 * - hover: prefetch when user hovers a target element
 * - visible: prefetch when target element enters viewport (IntersectionObserver)
 * - idle: prefetch during browser idle time (requestIdleCallback)
 *
 * @example
 * // Prefetch immediately
 * wu.prefetch('cart');
 *
 * // Prefetch when user hovers the cart link
 * wu.prefetch('cart', { on: 'hover', target: '#cart-link' });
 *
 * // Prefetch when the section becomes visible
 * wu.prefetch('cart', { on: 'visible', target: '#cart-section' });
 *
 * // Prefetch during idle time
 * wu.prefetch('cart', { on: 'idle' });
 *
 * // Prefetch multiple apps with eagerness control
 * wu.prefetch(['cart', 'profile'], { eagerness: 'moderate' });
 */

import { logger } from './wu-logger.js';

export class WuPrefetch {
  constructor(core) {
    this.core = core;

    // Track what we've already prefetched to avoid duplicates
    this.prefetched = new Set();

    // Active observers and listeners (for cleanup)
    this._observers = new Map();
    this._listeners = [];

    // Speculation Rules script element (one per page, updated dynamically)
    this._speculationScript = null;
    this._speculationRules = { prefetch: [], prerender: [] };

    // Detect browser support
    this.supportsSpeculationRules = this._detectSpeculationRules();
    this.supportsModulePreload = this._detectModulePreload();

    logger.wuDebug(
      `[WuPrefetch] Initialized — ` +
      `Speculation Rules: ${this.supportsSpeculationRules ? 'yes' : 'no'}, ` +
      `Module Preload: ${this.supportsModulePreload ? 'yes' : 'no'}`
    );
  }

  // ─── Detection ───────────────────────────────────────────────

  _detectSpeculationRules() {
    if (typeof HTMLScriptElement === 'undefined') return false;
    return HTMLScriptElement.supports?.('speculationrules') ?? false;
  }

  _detectModulePreload() {
    if (typeof document === 'undefined') return false;
    const link = document.createElement('link');
    return link.relList?.supports?.('modulepreload') ?? false;
  }

  // ─── Main API ────────────────────────────────────────────────

  /**
   * Prefetch one or more apps.
   *
   * @param {string|string[]} appNames - App name(s) to prefetch
   * @param {Object} [options]
   * @param {'immediate'|'hover'|'visible'|'idle'} [options.on='immediate'] - Trigger mode
   * @param {string|Element} [options.target] - CSS selector or element (for hover/visible)
   * @param {'conservative'|'moderate'|'eager'} [options.eagerness='moderate'] - Speculation Rules eagerness
   * @returns {Promise<void>|Function} Promise for immediate, cleanup function for deferred
   */
  async prefetch(appNames, options = {}) {
    const names = Array.isArray(appNames) ? appNames : [appNames];
    const trigger = options.on || 'immediate';

    switch (trigger) {
      case 'immediate':
        return this._prefetchImmediate(names, options);

      case 'hover':
        return this._prefetchOnHover(names, options);

      case 'visible':
        return this._prefetchOnVisible(names, options);

      case 'idle':
        return this._prefetchOnIdle(names, options);

      default:
        logger.wuWarn(`[WuPrefetch] Unknown trigger "${trigger}", using immediate`);
        return this._prefetchImmediate(names, options);
    }
  }

  // ─── Immediate Prefetch ──────────────────────────────────────

  async _prefetchImmediate(appNames, options) {
    const urls = await this._resolveAppUrls(appNames);
    if (urls.length === 0) return;

    // Mark all as prefetched by name (prevents duplicate resolution)
    urls.forEach(({ name }) => this.prefetched.add(name));

    // Strategy 1: Speculation Rules API (Chrome 121+)
    if (this.supportsSpeculationRules) {
      this._addSpeculationRules(urls, options.eagerness || 'moderate');
      return;
    }

    // Strategy 2: <link rel="modulepreload"> for ES modules
    if (this.supportsModulePreload) {
      urls.forEach(({ url }) => this._injectModulePreload(url));
      return;
    }

    // Strategy 3: <link rel="prefetch"> fallback
    urls.forEach(({ url }) => this._injectPrefetch(url));
  }

  // ─── Hover Trigger ───────────────────────────────────────────

  _prefetchOnHover(appNames, options) {
    const target = this._resolveTarget(options.target);
    if (!target) {
      logger.wuWarn('[WuPrefetch] hover trigger requires a target element or selector');
      return () => {};
    }

    let done = false;

    const handler = () => {
      if (done) return;
      done = true;
      this._prefetchImmediate(appNames, options);
      // One-shot: remove after first trigger
      target.removeEventListener('mouseenter', handler);
      target.removeEventListener('focusin', handler);
    };

    // Mouse hover OR keyboard focus
    target.addEventListener('mouseenter', handler, { passive: true });
    target.addEventListener('focusin', handler, { passive: true });

    const cleanup = () => {
      target.removeEventListener('mouseenter', handler);
      target.removeEventListener('focusin', handler);
    };

    this._listeners.push(cleanup);
    return cleanup;
  }

  // ─── Visibility Trigger (IntersectionObserver) ───────────────

  _prefetchOnVisible(appNames, options) {
    const target = this._resolveTarget(options.target);
    if (!target) {
      logger.wuWarn('[WuPrefetch] visible trigger requires a target element or selector');
      return () => {};
    }

    if (typeof IntersectionObserver === 'undefined') {
      // No IntersectionObserver → prefetch immediately
      this._prefetchImmediate(appNames, options);
      return () => {};
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._prefetchImmediate(appNames, options);
            observer.disconnect();
            this._observers.delete(target);
            break;
          }
        }
      },
      { rootMargin: '200px' } // Start prefetching 200px before visible
    );

    observer.observe(target);
    this._observers.set(target, observer);

    const cleanup = () => {
      observer.disconnect();
      this._observers.delete(target);
    };

    return cleanup;
  }

  // ─── Idle Trigger ────────────────────────────────────────────

  _prefetchOnIdle(appNames, options) {
    const callback = () => this._prefetchImmediate(appNames, options);

    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(callback, { timeout: 3000 });
      const cleanup = () => cancelIdleCallback(id);
      this._listeners.push(cleanup);
      return cleanup;
    }

    // Fallback: setTimeout 2s
    const id = setTimeout(callback, 2000);
    const cleanup = () => clearTimeout(id);
    this._listeners.push(cleanup);
    return cleanup;
  }

  // ─── Speculation Rules API ───────────────────────────────────

  _addSpeculationRules(urls, eagerness) {
    const newEntries = urls.filter(({ name }) => !this.prefetched.has(name));
    if (newEntries.length === 0) return;

    // Mark as prefetched
    newEntries.forEach(({ name }) => this.prefetched.add(name));

    // Build URL list for speculation rules
    const urlList = newEntries.map(({ url }) => url);

    // Add prefetch rule
    this._speculationRules.prefetch.push({
      source: 'list',
      urls: urlList,
      eagerness
    });

    // Inject or update the speculation rules script
    this._updateSpeculationScript();

    logger.wuDebug(
      `[WuPrefetch] Speculation Rules: prefetch ${newEntries.map(e => e.name).join(', ')} ` +
      `(eagerness: ${eagerness})`
    );
  }

  _updateSpeculationScript() {
    // Remove existing script (spec requires replacing, not updating)
    if (this._speculationScript) {
      this._speculationScript.remove();
    }

    const script = document.createElement('script');
    script.type = 'speculationrules';
    script.textContent = JSON.stringify(this._speculationRules);
    document.head.appendChild(script);

    this._speculationScript = script;
  }

  // ─── Module Preload ──────────────────────────────────────────

  _injectModulePreload(url) {
    if (this.prefetched.has(url)) return;
    this.prefetched.add(url);

    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = url;
    document.head.appendChild(link);

    logger.wuDebug(`[WuPrefetch] modulepreload: ${url}`);
  }

  // ─── Generic Prefetch ────────────────────────────────────────

  _injectPrefetch(url) {
    if (this.prefetched.has(url)) return;
    this.prefetched.add(url);

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'script';
    document.head.appendChild(link);

    logger.wuDebug(`[WuPrefetch] prefetch: ${url}`);
  }

  // ─── URL Resolution ──────────────────────────────────────────

  /**
   * Resolve app names to their module URLs.
   * Skips apps that are already mounted, already prefetched, or not registered.
   */
  async _resolveAppUrls(appNames) {
    const results = [];

    for (const name of appNames) {
      // Skip if already prefetched
      if (this.prefetched.has(name)) {
        logger.wuDebug(`[WuPrefetch] ${name} already prefetched, skipping`);
        continue;
      }

      // Skip if already mounted (no need to prefetch)
      if (this.core.mounted.has(name)) {
        logger.wuDebug(`[WuPrefetch] ${name} already mounted, skipping`);
        continue;
      }

      // Skip if already loaded (definition exists)
      if (this.core.definitions.has(name)) {
        logger.wuDebug(`[WuPrefetch] ${name} already defined, skipping`);
        continue;
      }

      const app = this.core.apps.get(name);
      if (!app) {
        logger.wuWarn(`[WuPrefetch] App "${name}" not registered, cannot prefetch`);
        continue;
      }

      try {
        const url = await this.core.resolveModulePath(app);
        results.push({ name, url });
      } catch (error) {
        logger.wuWarn(`[WuPrefetch] Failed to resolve URL for "${name}":`, error.message);
      }
    }

    return results;
  }

  // ─── Helpers ─────────────────────────────────────────────────

  _resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    if (target instanceof Element) return target;
    return null;
  }

  // ─── Prefetch All Registered (utility) ───────────────────────

  /**
   * Prefetch all registered but not-yet-mounted apps.
   * Useful for aggressive prefetching after initial load.
   *
   * @param {Object} [options] - Same options as prefetch()
   */
  async prefetchAll(options = {}) {
    const unmountedApps = [];
    for (const [name] of this.core.apps) {
      if (!this.core.mounted.has(name) && !this.prefetched.has(name)) {
        unmountedApps.push(name);
      }
    }

    if (unmountedApps.length === 0) {
      logger.wuDebug('[WuPrefetch] No apps to prefetch');
      return;
    }

    logger.wuDebug(`[WuPrefetch] Prefetching all: ${unmountedApps.join(', ')}`);
    return this.prefetch(unmountedApps, options);
  }

  // ─── Stats ───────────────────────────────────────────────────

  getStats() {
    return {
      prefetched: [...this.prefetched],
      activeObservers: this._observers.size,
      activeListeners: this._listeners.length,
      speculationRulesSupported: this.supportsSpeculationRules,
      modulePreloadSupported: this.supportsModulePreload,
      speculationRules: this._speculationRules
    };
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  cleanup() {
    // Disconnect all IntersectionObservers
    for (const [, observer] of this._observers) {
      observer.disconnect();
    }
    this._observers.clear();

    // Remove all event listeners
    for (const cleanup of this._listeners) {
      cleanup();
    }
    this._listeners = [];

    // Remove speculation rules script
    if (this._speculationScript) {
      this._speculationScript.remove();
      this._speculationScript = null;
    }

    this._speculationRules = { prefetch: [], prerender: [] };
    this.prefetched.clear();

    logger.wuDebug('[WuPrefetch] Cleaned up');
  }
}
