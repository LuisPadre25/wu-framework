/**
 * Tests for WuPrefetch — Speculation Rules API + fallbacks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuPrefetch } from '../../src/core/wu-prefetch.js';

// Mock core that simulates WuCore
function createMockCore(apps = {}) {
  const core = {
    apps: new Map(),
    mounted: new Map(),
    definitions: new Map(),
    resolveModulePath: vi.fn(async (app) => `http://localhost:${app.port}/src/main.js`),
  };

  for (const [name, config] of Object.entries(apps)) {
    core.apps.set(name, { name, url: config.url, port: config.port || 3000 });
  }

  return core;
}

// Mock IntersectionObserver for jsdom
class MockIntersectionObserver {
  constructor(callback, options) {
    this._callback = callback;
    this._options = options;
    this._elements = new Set();
  }
  observe(el) { this._elements.add(el); }
  unobserve(el) { this._elements.delete(el); }
  disconnect() { this._elements.clear(); }
  // Helper to simulate intersection
  _trigger(entries) { this._callback(entries, this); }
}

describe('WuPrefetch', () => {
  let prefetcher;
  let core;
  let originalIO;

  beforeEach(() => {
    // Clean up head
    document.head.innerHTML = '';

    // Install mock IntersectionObserver
    originalIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver;

    core = createMockCore({
      header: { url: 'http://localhost:4221', port: 4221 },
      cart: { url: 'http://localhost:3847', port: 3847 },
      profile: { url: 'http://localhost:5100', port: 5100 },
    });

    prefetcher = new WuPrefetch(core);
  });

  afterEach(() => {
    prefetcher.cleanup();
    document.head.innerHTML = '';
    globalThis.IntersectionObserver = originalIO;
  });

  // ─── Basic Prefetch ────────────────────────────────────────

  describe('immediate prefetch', () => {
    it('should prefetch a single app', async () => {
      await prefetcher.prefetch('cart');

      expect(core.resolveModulePath).toHaveBeenCalledOnce();
      expect(prefetcher.prefetched.size).toBeGreaterThan(0);
    });

    it('should prefetch multiple apps', async () => {
      await prefetcher.prefetch(['cart', 'profile']);

      expect(core.resolveModulePath).toHaveBeenCalledTimes(2);
    });

    it('should not prefetch same app twice', async () => {
      await prefetcher.prefetch('cart');
      await prefetcher.prefetch('cart');

      // resolveModulePath called once for initial resolve,
      // second call should skip because already prefetched
      expect(core.resolveModulePath).toHaveBeenCalledOnce();
    });

    it('should skip already mounted apps', async () => {
      core.mounted.set('cart', { app: { name: 'cart' } });

      await prefetcher.prefetch('cart');

      expect(core.resolveModulePath).not.toHaveBeenCalled();
    });

    it('should skip already defined apps', async () => {
      core.definitions.set('cart', { mount: () => {}, unmount: () => {} });

      await prefetcher.prefetch('cart');

      expect(core.resolveModulePath).not.toHaveBeenCalled();
    });

    it('should skip unregistered apps', async () => {
      await prefetcher.prefetch('nonexistent');

      expect(core.resolveModulePath).not.toHaveBeenCalled();
    });

    it('should inject link tags when Speculation Rules not supported', async () => {
      await prefetcher.prefetch('cart');

      const links = document.head.querySelectorAll('link');
      expect(links.length).toBeGreaterThan(0);

      const link = links[0];
      expect(link.href).toContain('localhost');
      expect(['prefetch', 'modulepreload']).toContain(link.rel);
    });
  });

  // ─── Speculation Rules ─────────────────────────────────────

  describe('Speculation Rules API', () => {
    it('should detect speculation rules support', () => {
      // jsdom doesn't support it, so this should be false
      expect(prefetcher.supportsSpeculationRules).toBe(false);
    });

    it('should build speculation rules structure correctly', () => {
      // Force support for testing
      prefetcher.supportsSpeculationRules = true;

      prefetcher._addSpeculationRules(
        [{ name: 'cart', url: 'http://localhost:3847/src/main.js' }],
        'moderate'
      );

      expect(prefetcher._speculationRules.prefetch).toHaveLength(1);
      expect(prefetcher._speculationRules.prefetch[0]).toEqual({
        source: 'list',
        urls: ['http://localhost:3847/src/main.js'],
        eagerness: 'moderate',
      });
    });

    it('should inject script[type=speculationrules] when supported', () => {
      prefetcher.supportsSpeculationRules = true;

      prefetcher._addSpeculationRules(
        [{ name: 'cart', url: 'http://localhost:3847/src/main.js' }],
        'moderate'
      );

      const script = document.head.querySelector('script[type="speculationrules"]');
      expect(script).not.toBeNull();

      const rules = JSON.parse(script.textContent);
      expect(rules.prefetch).toHaveLength(1);
      expect(rules.prefetch[0].urls).toContain('http://localhost:3847/src/main.js');
    });

    it('should replace script tag on subsequent calls (not duplicate)', () => {
      prefetcher.supportsSpeculationRules = true;

      prefetcher._addSpeculationRules(
        [{ name: 'cart', url: 'http://localhost:3847/src/main.js' }],
        'moderate'
      );

      prefetcher._addSpeculationRules(
        [{ name: 'profile', url: 'http://localhost:5100/src/main.js' }],
        'eager'
      );

      const scripts = document.head.querySelectorAll('script[type="speculationrules"]');
      expect(scripts.length).toBe(1); // One script, not two

      const rules = JSON.parse(scripts[0].textContent);
      expect(rules.prefetch).toHaveLength(2); // Both rules inside
    });
  });

  // ─── Hover Trigger ─────────────────────────────────────────

  describe('hover trigger', () => {
    it('should prefetch on mouseenter', async () => {
      const target = document.createElement('a');
      target.id = 'cart-link';
      document.body.appendChild(target);

      prefetcher._prefetchOnHover(['cart'], { target });

      // Simulate hover
      target.dispatchEvent(new Event('mouseenter'));

      // Wait for async prefetch
      await new Promise((r) => setTimeout(r, 50));

      expect(core.resolveModulePath).toHaveBeenCalled();

      document.body.removeChild(target);
    });

    it('should prefetch on focusin (keyboard)', async () => {
      const target = document.createElement('a');
      document.body.appendChild(target);

      prefetcher._prefetchOnHover(['cart'], { target });

      target.dispatchEvent(new Event('focusin'));

      await new Promise((r) => setTimeout(r, 50));

      expect(core.resolveModulePath).toHaveBeenCalled();

      document.body.removeChild(target);
    });

    it('should only trigger once', async () => {
      const target = document.createElement('a');
      document.body.appendChild(target);

      prefetcher._prefetchOnHover(['cart'], { target });

      target.dispatchEvent(new Event('mouseenter'));
      target.dispatchEvent(new Event('mouseenter'));
      target.dispatchEvent(new Event('mouseenter'));

      await new Promise((r) => setTimeout(r, 50));

      expect(core.resolveModulePath).toHaveBeenCalledOnce();

      document.body.removeChild(target);
    });

    it('should resolve CSS selectors as targets', () => {
      const target = document.createElement('a');
      target.id = 'my-link';
      document.body.appendChild(target);

      const resolved = prefetcher._resolveTarget('#my-link');
      expect(resolved).toBe(target);

      document.body.removeChild(target);
    });

    it('should return cleanup function', () => {
      const target = document.createElement('a');
      document.body.appendChild(target);

      const cleanup = prefetcher._prefetchOnHover(['cart'], { target });
      expect(typeof cleanup).toBe('function');

      cleanup(); // Should not throw

      document.body.removeChild(target);
    });
  });

  // ─── Visibility Trigger ────────────────────────────────────

  describe('visible trigger', () => {
    it('should create IntersectionObserver', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      prefetcher._prefetchOnVisible(['cart'], { target });

      expect(prefetcher._observers.size).toBe(1);

      document.body.removeChild(target);
    });

    it('should return cleanup function that disconnects observer', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const cleanup = prefetcher._prefetchOnVisible(['cart'], { target });
      expect(prefetcher._observers.size).toBe(1);

      cleanup();
      expect(prefetcher._observers.size).toBe(0);

      document.body.removeChild(target);
    });
  });

  // ─── Idle Trigger ──────────────────────────────────────────

  describe('idle trigger', () => {
    it('should return cleanup function', () => {
      const cleanup = prefetcher._prefetchOnIdle(['cart'], {});
      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });
  });

  // ─── prefetchAll ───────────────────────────────────────────

  describe('prefetchAll', () => {
    it('should prefetch all registered unmounted apps', async () => {
      await prefetcher.prefetchAll();

      // 3 apps registered, none mounted → 3 resolved
      expect(core.resolveModulePath).toHaveBeenCalledTimes(3);
    });

    it('should skip mounted apps', async () => {
      core.mounted.set('header', {});

      await prefetcher.prefetchAll();

      // 3 registered, 1 mounted → 2 resolved
      expect(core.resolveModulePath).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return current state', async () => {
      await prefetcher.prefetch('cart');

      const stats = prefetcher.getStats();
      expect(stats.prefetched.length).toBeGreaterThan(0);
      expect(stats).toHaveProperty('speculationRulesSupported');
      expect(stats).toHaveProperty('modulePreloadSupported');
    });
  });

  // ─── Cleanup ───────────────────────────────────────────────

  describe('cleanup', () => {
    it('should clear all state', async () => {
      await prefetcher.prefetch('cart');

      const target = document.createElement('div');
      document.body.appendChild(target);
      prefetcher._prefetchOnVisible(['profile'], { target });

      expect(prefetcher.prefetched.size).toBeGreaterThan(0);
      expect(prefetcher._observers.size).toBe(1);

      prefetcher.cleanup();

      expect(prefetcher.prefetched.size).toBe(0);
      expect(prefetcher._observers.size).toBe(0);
      expect(prefetcher._listeners.length).toBe(0);

      document.body.removeChild(target);
    });

    it('should remove speculation rules script', () => {
      prefetcher.supportsSpeculationRules = true;

      prefetcher._addSpeculationRules(
        [{ name: 'cart', url: 'http://localhost:3847/src/main.js' }],
        'moderate'
      );

      expect(document.head.querySelector('script[type="speculationrules"]')).not.toBeNull();

      prefetcher.cleanup();

      expect(document.head.querySelector('script[type="speculationrules"]')).toBeNull();
    });
  });
});
