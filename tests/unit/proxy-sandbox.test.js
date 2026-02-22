import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuProxySandbox } from '../../src/core/wu-proxy-sandbox.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

describe('WuProxySandbox', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = new WuProxySandbox('test-app');
  });

  afterEach(() => {
    if (sandbox.isActive()) {
      sandbox.deactivate();
    }
  });

  // ============================================================
  // LIFECYCLE
  // ============================================================

  describe('lifecycle', () => {
    it('should create inactive sandbox', () => {
      expect(sandbox.isActive()).toBe(false);
      expect(sandbox.getProxy()).toBeNull();
    });

    it('should activate and return proxy', () => {
      const proxy = sandbox.activate();
      expect(proxy).toBeTruthy();
      expect(sandbox.isActive()).toBe(true);
      expect(sandbox.getProxy()).toBe(proxy);
    });

    it('should return same proxy on double activate', () => {
      const proxy1 = sandbox.activate();
      const proxy2 = sandbox.activate();
      expect(proxy1).toBe(proxy2);
    });

    it('should deactivate and cleanup', () => {
      sandbox.activate();
      sandbox.deactivate();
      expect(sandbox.isActive()).toBe(false);
      expect(sandbox.getProxy()).toBeNull();
    });

    it('should not throw on double deactivate', () => {
      sandbox.activate();
      sandbox.deactivate();
      expect(() => sandbox.deactivate()).not.toThrow();
    });
  });

  // ============================================================
  // PROPERTY ISOLATION
  // ============================================================

  describe('property isolation', () => {
    it('should isolate property writes to fakeWindow', () => {
      const proxy = sandbox.activate();
      proxy.myAppVar = 'hello';
      expect(proxy.myAppVar).toBe('hello');
      expect(window.myAppVar).toBeUndefined();
    });

    it('should read from fakeWindow first, then real window', () => {
      const proxy = sandbox.activate();
      // Real window property
      expect(proxy.location).toBe(window.location);
      // Override in fake
      proxy.location = 'fake';
      expect(proxy.location).toBe('fake');
    });

    it('should track modified keys', () => {
      const proxy = sandbox.activate();
      proxy.foo = 1;
      proxy.bar = 2;
      const stats = sandbox.getStats();
      expect(stats.modifiedKeys).toContain('foo');
      expect(stats.modifiedKeys).toContain('bar');
    });

    it('should support delete on isolated properties', () => {
      const proxy = sandbox.activate();
      proxy.tempVar = 'temp';
      expect(proxy.tempVar).toBe('temp');
      delete proxy.tempVar;
      expect(proxy.tempVar).toBeUndefined();
    });

    it('should support has operator', () => {
      const proxy = sandbox.activate();
      proxy.existsInFake = true;
      expect('existsInFake' in proxy).toBe(true);
      expect('location' in proxy).toBe(true); // real window
      expect('nonExistentProp12345' in proxy).toBe(false);
    });

    it('should clean all isolated properties on deactivate', () => {
      const proxy = sandbox.activate();
      proxy.a = 1;
      proxy.b = 2;
      proxy.c = 3;
      sandbox.deactivate();
      expect(sandbox.getStats().isolatedPropsCount).toBe(0);
      expect(sandbox.getStats().modifiedKeys).toHaveLength(0);
    });
  });

  // ============================================================
  // TIMER HIJACKING
  // ============================================================

  describe('timer hijacking (via proxy)', () => {
    it('should track setTimeout through proxy', () => {
      const proxy = sandbox.activate();
      const fn = vi.fn();
      const id = proxy.setTimeout(fn, 10000);
      expect(id).toBeDefined();
      expect(sandbox.getStats().trackedTimers).toBe(1);
      proxy.clearTimeout(id);
      expect(sandbox.getStats().trackedTimers).toBe(0);
    });

    it('should track setInterval through proxy', () => {
      const proxy = sandbox.activate();
      const fn = vi.fn();
      const id = proxy.setInterval(fn, 10000);
      expect(sandbox.getStats().trackedIntervals).toBe(1);
      proxy.clearInterval(id);
      expect(sandbox.getStats().trackedIntervals).toBe(0);
    });

    it('should clean all timers on deactivate', () => {
      const proxy = sandbox.activate();
      const fn = vi.fn();
      proxy.setTimeout(fn, 100000);
      proxy.setTimeout(fn, 100000);
      proxy.setInterval(fn, 100000);
      expect(sandbox.getStats().trackedTimers).toBe(2);
      expect(sandbox.getStats().trackedIntervals).toBe(1);
      sandbox.deactivate();
      // After deactivate, stats are zeroed
      expect(sandbox.getStats().trackedTimers).toBe(0);
      expect(sandbox.getStats().trackedIntervals).toBe(0);
    });
  });

  // ============================================================
  // EVENT LISTENER TRACKING
  // ============================================================

  describe('event listener tracking (via proxy)', () => {
    it('should track addEventListener through proxy', () => {
      const proxy = sandbox.activate();
      const handler = vi.fn();
      proxy.addEventListener('click', handler);
      expect(sandbox.getStats().trackedEventListeners).toBe(1);
    });

    it('should untrack on removeEventListener', () => {
      const proxy = sandbox.activate();
      const handler = vi.fn();
      proxy.addEventListener('click', handler);
      expect(sandbox.getStats().trackedEventListeners).toBe(1);
      proxy.removeEventListener('click', handler);
      expect(sandbox.getStats().trackedEventListeners).toBe(0);
    });

    it('should clean all listeners on deactivate', () => {
      const proxy = sandbox.activate();
      const h1 = vi.fn();
      const h2 = vi.fn();
      proxy.addEventListener('click', h1);
      proxy.addEventListener('resize', h2);
      expect(sandbox.getStats().trackedEventListeners).toBe(2);
      sandbox.deactivate();
      expect(sandbox.getStats().trackedEventListeners).toBe(0);
    });
  });

  // ============================================================
  // WINDOW PATCHING
  // ============================================================

  describe('patchWindow / unpatchWindow', () => {
    afterEach(() => {
      // Safety: always unpatch
      sandbox.unpatchWindow();
    });

    it('should patch and unpatch window.setTimeout', () => {
      sandbox.activate();
      const original = window.setTimeout;
      sandbox.patchWindow();
      expect(window.setTimeout).not.toBe(original);
      expect(sandbox.getStats().patched).toBe(true);

      sandbox.unpatchWindow();
      expect(window.setTimeout).toBe(original);
      expect(sandbox.getStats().patched).toBe(false);
    });

    it('should track timers created via patched window', () => {
      sandbox.activate();
      sandbox.patchWindow();
      const fn = vi.fn();
      const id = window.setTimeout(fn, 100000);
      expect(sandbox.getStats().trackedTimers).toBe(1);
      window.clearTimeout(id);
      expect(sandbox.getStats().trackedTimers).toBe(0);
      sandbox.unpatchWindow();
    });

    it('should track event listeners via patched window', () => {
      sandbox.activate();
      sandbox.patchWindow();
      const handler = vi.fn();
      window.addEventListener('test-event', handler);
      expect(sandbox.getStats().trackedEventListeners).toBe(1);
      sandbox.unpatchWindow();
    });

    it('deactivate should unpatch automatically', () => {
      sandbox.activate();
      const original = window.setTimeout;
      sandbox.patchWindow();
      expect(window.setTimeout).not.toBe(original);
      sandbox.deactivate();
      expect(window.setTimeout).toBe(original);
    });

    it('should not double-patch', () => {
      sandbox.activate();
      sandbox.patchWindow();
      const patchedFn = window.setTimeout;
      sandbox.patchWindow(); // second call
      expect(window.setTimeout).toBe(patchedFn); // same patched function
      sandbox.unpatchWindow();
    });
  });

  // ============================================================
  // DOM SCOPING
  // ============================================================

  describe('DOM scoping', () => {
    it('should scope document.querySelector to shadow root', () => {
      // Create a mock shadow root with content
      const mockRoot = document.createElement('div');
      const inner = document.createElement('span');
      inner.className = 'scoped-element';
      mockRoot.appendChild(inner);

      sandbox.setContainer(mockRoot, mockRoot);
      const proxy = sandbox.activate();
      const scopedDoc = proxy.document;

      const found = scopedDoc.querySelector('.scoped-element');
      expect(found).toBeTruthy();
      expect(found.className).toBe('scoped-element');
    });

    it('should NOT find elements outside the container', () => {
      const outsideEl = document.createElement('div');
      outsideEl.id = 'outside-sandbox';
      document.body.appendChild(outsideEl);

      const mockRoot = document.createElement('div');
      sandbox.setContainer(mockRoot, mockRoot);
      const proxy = sandbox.activate();
      const scopedDoc = proxy.document;

      const found = scopedDoc.querySelector('#outside-sandbox');
      expect(found).toBeNull();

      document.body.removeChild(outsideEl);
    });

    it('should pass through createElement to real document', () => {
      const mockRoot = document.createElement('div');
      sandbox.setContainer(mockRoot, mockRoot);
      const proxy = sandbox.activate();
      const scopedDoc = proxy.document;

      const el = scopedDoc.createElement('div');
      expect(el).toBeInstanceOf(HTMLDivElement);
    });

    it('should fall back to real document if no container set', () => {
      const proxy = sandbox.activate();
      // No setContainer called
      expect(proxy.document).toBe(document);
    });
  });

  // ============================================================
  // STORAGE SCOPING
  // ============================================================

  describe('storage scoping', () => {
    afterEach(() => {
      // Clean up any prefixed keys
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('wu_')) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    });

    it('should prefix localStorage keys with app name', () => {
      const proxy = sandbox.activate();
      const scopedStorage = proxy.localStorage;

      scopedStorage.setItem('theme', 'dark');
      expect(localStorage.getItem('wu_test-app_theme')).toBe('dark');
      expect(scopedStorage.getItem('theme')).toBe('dark');
    });

    it('should not see other apps keys', () => {
      localStorage.setItem('wu_other-app_theme', 'light');

      const proxy = sandbox.activate();
      const scopedStorage = proxy.localStorage;

      expect(scopedStorage.getItem('theme')).toBeNull();
    });

    it('should clear only own keys', () => {
      localStorage.setItem('wu_other-app_data', 'keep-me');
      localStorage.setItem('global_key', 'keep-me-too');

      const proxy = sandbox.activate();
      const scopedStorage = proxy.localStorage;
      scopedStorage.setItem('a', '1');
      scopedStorage.setItem('b', '2');

      scopedStorage.clear();

      expect(localStorage.getItem('wu_test-app_a')).toBeNull();
      expect(localStorage.getItem('wu_test-app_b')).toBeNull();
      expect(localStorage.getItem('wu_other-app_data')).toBe('keep-me');
      expect(localStorage.getItem('global_key')).toBe('keep-me-too');

      localStorage.removeItem('wu_other-app_data');
      localStorage.removeItem('global_key');
    });

    it('should report correct length', () => {
      const proxy = sandbox.activate();
      const scopedStorage = proxy.localStorage;

      expect(scopedStorage.length).toBe(0);
      scopedStorage.setItem('x', '1');
      scopedStorage.setItem('y', '2');
      expect(scopedStorage.length).toBe(2);
    });

    it('should removeItem correctly', () => {
      const proxy = sandbox.activate();
      const scopedStorage = proxy.localStorage;

      scopedStorage.setItem('temp', 'val');
      expect(scopedStorage.getItem('temp')).toBe('val');
      scopedStorage.removeItem('temp');
      expect(scopedStorage.getItem('temp')).toBeNull();
    });
  });

  // ============================================================
  // STATS
  // ============================================================

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      sandbox.activate();
      const stats = sandbox.getStats();
      expect(stats).toHaveProperty('appName', 'test-app');
      expect(stats).toHaveProperty('active', true);
      expect(stats).toHaveProperty('patched', false);
      expect(stats).toHaveProperty('trackedTimers', 0);
      expect(stats).toHaveProperty('trackedIntervals', 0);
      expect(stats).toHaveProperty('trackedRAFs', 0);
      expect(stats).toHaveProperty('trackedEventListeners', 0);
    });
  });
});
